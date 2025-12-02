## homebridge-fronius-ohmpilot-temperature

Homebridge accessory plugin that exposes the **Fronius Ohmpilot** temperature as a HomeKit `TemperatureSensor`.

### Installation

From your Homebridge server (or via the UI):

```bash
npm install -g homebridge-fronius-ohmpilot-temperature
```

### Configuration

Add an accessory entry to your Homebridge `config.json`:

```json
{
  "accessories": [
    {
      "accessory": "FroniusOhmpilotTemperature",
      "name": "Ohmpilot Temperature",
      "host": "192.168.1.50",
      "pollInterval": 60
    }
  ]
}
```

- **accessory**: Must be `FroniusOhmpilotTemperature`.
- **name**: The accessory name shown in HomeKit.
- **host**: IP or hostname of the Fronius device that exposes the Ohmpilot API (e.g. Datamanager / inverter).
- **pollInterval** (optional): How often (in seconds) to poll the temperature in the background. Default: `60`.

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


