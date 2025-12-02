const axios = require('axios');

let Service;
let Characteristic;

module.exports = (api) => {
  Service = api.hap.Service;
  Characteristic = api.hap.Characteristic;

  api.registerAccessory(
    'homebridge-fronius-ohmpilot-temperature',
    'FroniusOhmpilotTemperature',
    FroniusOhmpilotTemperatureAccessory,
  );
};

class FroniusOhmpilotTemperatureAccessory {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;

    this.name = config.name || 'Ohmpilot Temperature';
    this.host = config.host;
    this.pollInterval = Number(config.pollInterval) || 60; // seconds

    if (!this.host) {
      this.log.warn('No "host" configured for Fronius Ohmpilot accessory.');
    }

    this.service = new Service.TemperatureSensor(this.name);

    this.service
      .getCharacteristic(Characteristic.CurrentTemperature)
      .setProps({
        minValue: -40,
        maxValue: 125,
      })
      .onGet(this.handleGetTemperature.bind(this));

    // Periodic update
    if (this.pollInterval > 0 && this.host) {
      const intervalMs = this.pollInterval * 1000;
      this.timer = setInterval(() => {
        this.updateTemperature().catch((err) =>
          this.log.debug('Background temperature update failed:', err?.message || err),
        );
      }, intervalMs);

      if (this.timer.unref) {
        this.timer.unref();
      }
    }
  }

  async handleGetTemperature() {
    const temp = await this.fetchTemperature();
    if (typeof temp === 'number') {
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, temp);
      return temp;
    }

    // HomeKit expects a number; if we fail, log and return last known or 0
    this.log.error('Failed to read Ohmpilot temperature, returning 0.');
    return 0;
  }

  async updateTemperature() {
    const temp = await this.fetchTemperature();
    if (typeof temp === 'number') {
      this.service.updateCharacteristic(Characteristic.CurrentTemperature, temp);
    }
  }

  async fetchTemperature() {
    if (!this.host) {
      this.log.error('No host configured for Fronius Ohmpilot temperature.');
      return undefined;
    }

    const url = `http://${this.host}/solar_api/v1/GetOhmPilotRealtimeData.cgi?Scope=System`;

    try {
      const response = await axios.get(url, {
        timeout: 5000,
      });

      const data = response?.data;
      const temperature =
        data &&
        data.Body &&
        data.Body.Data &&
        (data.Body.Data.Temperature_Channel_1 ??
          data.Body.Data['Temperature_Channel_1']);

      if (typeof temperature !== 'number') {
        this.log.error(
          'Unexpected Ohmpilot response structure or missing temperature. Got:',
          JSON.stringify(data),
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

  identify(callback) {
    this.log('Identify requested for Fronius Ohmpilot temperature accessory.');
    callback();
  }

  getServices() {
    const informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Fronius')
      .setCharacteristic(Characteristic.Model, 'Ohmpilot')
      .setCharacteristic(Characteristic.SerialNumber, 'Ohmpilot-Temperature');

    return [informationService, this.service];
  }
}


