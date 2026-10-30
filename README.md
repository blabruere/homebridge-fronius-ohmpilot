## homebridge-fronius-ohmpilot

Homebridge plugin that exposes the **Fronius Ohmpilot** temperature as a HomeKit `TemperatureSensor`, plus an optional **Boost** switch. Click on the Temperature sensor in Home, and you can turn on/off boost by clicking on it. The button on/off state means Boost is on/off.

### Installation

Search for **Fronius Ohmpilot** in the Homebridge UI plugins tab, or install it from your Homebridge server:

```bash
npm install -g homebridge-fronius-ohmpilot
```

### Configuration

The easiest way is the plugin's **Settings** in the Homebridge UI. You can also add a platform entry to your Homebridge `config.json`:

```json
{
  "platforms": [
    {
      "platform": "Ohmpilot",
      "name": "Water temperature",
      "host": "INVERTER IP",
      "ohmpilotHost": "OHMPILOT IP",
      "boostName": "Ohmpilot Boost",
      "pollInterval": 60
    }
  ]
}
```

- **platform**: Must be `Ohmpilot`.
- **name** (optional): The temperature sensor name shown in HomeKit. Default: `Water temperature`.
- **host**: IP or hostname of the Fronius device that exposes the Ohmpilot API (e.g. Datamanager / inverter). The plugin does nothing until this is set.
- **ohmpilotHost** (optional): IP or hostname of the Ohmpilot's own web interface. Enables the Boost switch.
- **boostName** (optional): Name of the Boost switch in HomeKit. Default: `Ohmpilot Boost`.
- **boostRefreshDelay** (optional): Seconds to wait after toggling boost before re-reading the state. Default: `3`.
- **pollInterval** (optional): How often (in seconds) to poll the temperature and boost state in the background. Default: `60`.

### Upgrading from version 2.x

Version 3 is a platform plugin. Replace the old entry under `accessories` (`"accessory": "Ohmpilot"`) with the entry under `platforms` shown above, then restart Homebridge. HomeKit sees it as a new accessory, so you may need to put it back in its room and automations.

### How it works

The plugin calls the Fronius Ohmpilot realtime data API:

- `http://<host>/solar_api/v1/GetOhmPilotRealtimeData.cgi?Scope=System`

It expects a JSON response similar to:

```json
{
  "Body": {
    "Data": {
      "Temperature_Channel_1": 23.9
    }
  }
}
```

The value of `Temperature_Channel_1` (in °C) is mapped directly to the HomeKit `CurrentTemperature` characteristic.

### Boost switch

When `ohmpilotHost` is set, a HomeKit `Switch` is added:

- Its state is read from `http://<ohmpilotHost>/values.xml` (`valState` = `5` means boost is active).
- Turning it on or off calls `http://<ohmpilotHost>/setboost.cgi`, the same request as the Boost button on the Ohmpilot web page. That request toggles boost, so the plugin first checks the current state and only sends it when the state needs to change.
