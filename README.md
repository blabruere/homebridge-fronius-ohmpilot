## homebridge-fronius-ohmpilot

Homebridge accessory plugin that exposes the **Fronius Ohmpilot** temperature as a HomeKit `TemperatureSensor`, plus an optional **Boost** switch.

### Installation

From your Homebridge server (or via the UI):

```bash
npm install -g homebridge-fronius-ohmpilot
```

### Configuration

Add an accessory entry to your Homebridge `config.json`:

```json
{
  "accessories": [
    {
      "accessory": "Ohmpilot",
      "name": "Water temperature",
      "host": "192.168.1.50",
      "ohmpilotHost": "192.168.1.211",
      "boostName": "Ohmpilot Boost",
      "pollInterval": 60
    }
  ]
}
```

- **accessory**: Must be `Ohmpilot`.
- **name** (optional): The temperature sensor name shown in HomeKit. Default: `Water temperature`.
- **host**: IP or hostname of the Fronius device that exposes the Ohmpilot API (e.g. Datamanager / inverter).
- **ohmpilotHost** (optional): IP or hostname of the Ohmpilot's own web interface. Enables the Boost switch.
- **boostName** (optional): Name of the Boost switch in HomeKit. Default: `Ohmpilot Boost`.
- **boostRefreshDelay** (optional): Seconds to wait after toggling boost before re-reading the state. Default: `3`.
- **pollInterval** (optional): How often (in seconds) to poll the temperature and boost state in the background. Default: `60`.

### How it works

The plugin calls the Fronius Ohmpilot realtime data API:

- `http://<host>/solar_api/v1/GetOhmPilotRealtimeData.fcgi?Scope=System`

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
