const PLUGIN_NAME = 'homebridge-fronius-ohmpilot';
const PLATFORM_NAME = 'Ohmpilot';

// Ohmpilot state code (valState in values.xml / CodeOfState in the Solar API)
const OHMPILOT_STATE_BOOST = 5;

const REQUEST_TIMEOUT_MS = 5000;

async function httpGet(url) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    // fetch only says "fetch failed"; surface the network reason (ECONNREFUSED, timeout...)
    throw new Error(error?.cause?.message || error?.message || String(error));
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response;
}

module.exports = (api) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, OhmpilotPlatform);
};

class OhmpilotPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config || {};
    this.api = api;
    this.cachedAccessories = [];

    api.on('didFinishLaunching', () => {
      try {
        this.setup();
      } catch (error) {
        this.log.error('Failed to set up Ohmpilot accessory:', error?.message || error);
      }
    });

    api.on('shutdown', () => {
      this.device?.stop();
    });
  }

  // Called by Homebridge for each accessory restored from the cache
  configureAccessory(accessory) {
    this.cachedAccessories.push(accessory);
  }

  setup() {
    // Do nothing until the plugin is configured
    if (!this.config.host) {
      this.log.warn('No "host" configured; the Ohmpilot plugin will not start. Configure it in the plugin settings.');
      return;
    }

    const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:ohmpilot`);
    const name = this.config.name || 'Water temperature';

    let accessory = this.cachedAccessories.find((a) => a.UUID === uuid);
    if (!accessory) {
      this.log.info('Adding Ohmpilot accessory:', name);
      accessory = new this.api.platformAccessory(name, uuid);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // Remove accessories from older setups that are no longer used
    const stale = this.cachedAccessories.filter((a) => a.UUID !== uuid);
    if (stale.length > 0) {
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }

    this.device = new OhmpilotDevice(this, accessory);
  }
}

class OhmpilotDevice {
  constructor(platform, accessory) {
    const { Service, Characteristic } = platform.api.hap;
    const config = platform.config;

    this.log = platform.log;
    this.api = platform.api;
    this.Characteristic = Characteristic;

    this.name = config.name || 'Water temperature';
    this.host = config.host; // Inverter / Datamanager (Solar API)
    this.ohmpilotHost = config.ohmpilotHost; // Ohmpilot's own web interface
    this.pollInterval = Number(config.pollInterval) || 60; // seconds

    this.boostName = config.boostName || 'Ohmpilot Boost';
    this.boostRefreshDelay = Number(config.boostRefreshDelay ?? 3); // seconds

    this.lastTemperature = undefined;
    this.boostActive = false;

    accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'Fronius')
      .setCharacteristic(Characteristic.Model, 'Ohmpilot')
      .setCharacteristic(Characteristic.SerialNumber, 'Ohmpilot-Temperature');

    this.service =
      accessory.getService(Service.TemperatureSensor) ||
      accessory.addService(Service.TemperatureSensor, this.name);
    this.service.setCharacteristic(Characteristic.Name, this.name);

    this.service
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -40,
        maxValue: 125,
      })
      .onGet(this.handleGetTemperature.bind(this));

    // Boost switch: ON while the Ohmpilot is in boost, tap again to stop it
    const existingBoost = accessory.getServiceById(Service.Switch, 'boost');
    if (this.ohmpilotHost) {
      this.boostService = existingBoost || accessory.addService(Service.Switch, this.boostName, 'boost');
      this.boostService.setCharacteristic(Characteristic.Name, this.boostName);

      this.boostService
        .getCharacteristic(Characteristic.On)
        .onGet(this.handleGetBoost.bind(this))
        .onSet(this.handleSetBoost.bind(this));
    } else {
      this.log.warn('No "ohmpilotHost" configured; the Boost switch will not be available.');
      if (existingBoost) {
        accessory.removeService(existingBoost);
      }
    }

    accessory.on('identify', () => {
      this.log.info('Identify requested for Fronius Ohmpilot accessory.');
    });

    // Periodic update
    if (this.pollInterval > 0) {
      const intervalMs = this.pollInterval * 1000;
      this.timer = setInterval(() => {
        this.updateTemperature().catch((err) =>
          this.log.debug('Background temperature update failed:', err?.message || err),
        );
        this.updateBoost().catch((err) =>
          this.log.debug('Background boost update failed:', err?.message || err),
        );
      }, intervalMs);

      if (this.timer.unref) {
        this.timer.unref();
      }
    }

    this.updateTemperature().catch(() => {});
    this.updateBoost().catch(() => {});
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async handleGetTemperature() {
    const temp = await this.fetchTemperature();
    if (typeof temp === 'number') {
      this.lastTemperature = temp;
      this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, temp);
      return temp;
    }

    // HomeKit expects a number; if we fail, log and return last known or 0
    this.log.error('Failed to read Ohmpilot temperature, returning last known value.');
    return this.lastTemperature ?? 0;
  }

  async updateTemperature() {
    const temp = await this.fetchTemperature();
    if (typeof temp === 'number') {
      this.lastTemperature = temp;
      this.service.updateCharacteristic(this.Characteristic.CurrentTemperature, temp);
    }
  }

  async fetchTemperature() {
    const url = `http://${this.host}/solar_api/v1/GetOhmPilotRealtimeData.cgi?Scope=System`;

    try {
      const response = await httpGet(url);
      const data = await response.json();
      const temperature =
        data?.Body?.Data?.Temperature_Channel_1 ??
        data?.Body?.Data?.[0]?.Temperature_Channel_1;

      if (typeof temperature !== 'number') {
        this.log.error(
          'Unexpected Ohmpilot response structure or missing temperature. Got:',
          JSON.stringify(data?.Body),
        );
        return undefined;
      }

      this.log.debug('Read Ohmpilot temperature:', temperature);
      return temperature;
    } catch (error) {
      this.log.error('Error fetching Ohmpilot temperature:', error?.message || error);
      return undefined;
    }
  }

  async handleGetBoost() {
    // Answer from cache so the Home app stays responsive, refresh in the background
    this.updateBoost().catch(() => {});
    return this.boostActive;
  }

  async handleSetBoost(value) {
    const wanted = Boolean(value);

    // setboost.cgi toggles boost, so only call it when the real state differs
    const current = await this.fetchBoostState();
    if (typeof current !== 'boolean') {
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    if (current === wanted) {
      this.log.debug(`Ohmpilot boost already ${wanted ? 'ON' : 'OFF'}, nothing to do.`);
      this.boostActive = current;
      return;
    }

    try {
      await httpGet(`http://${this.ohmpilotHost}/setboost.cgi`);
      this.log.info(`Ohmpilot boost turned ${wanted ? 'ON' : 'OFF'}.`);
      this.boostActive = wanted;
    } catch (error) {
      this.log.error('Error toggling Ohmpilot boost:', error?.message || error);
      throw new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }

    // Confirm the actual state once the Ohmpilot has had time to switch
    if (this.boostRefreshDelay > 0) {
      setTimeout(() => {
        this.updateBoost().catch(() => {});
      }, this.boostRefreshDelay * 1000);
    }
  }

  async updateBoost() {
    if (!this.boostService) {
      return;
    }
    const active = await this.fetchBoostState();
    if (typeof active === 'boolean') {
      this.boostActive = active;
      this.boostService.updateCharacteristic(this.Characteristic.On, active);
    }
  }

  async fetchBoostState() {
    const url = `http://${this.ohmpilotHost}/values.xml`;

    try {
      const response = await httpGet(url);
      const xml = await response.text();

      const match = /<value id="valState">\s*(\d+)\s*<\/value>/.exec(xml);
      if (!match) {
        this.log.error('Unexpected Ohmpilot values.xml content, missing valState.');
        return undefined;
      }

      const state = Number(match[1]);
      this.log.debug('Read Ohmpilot state:', state);
      return state === OHMPILOT_STATE_BOOST;
    } catch (error) {
      this.log.error('Error fetching Ohmpilot boost state:', error?.message || error);
      return undefined;
    }
  }
}
