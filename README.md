# homebridge-mcuiot

This is a homebridge platform plugin, supporting multiple nodemcu device's
configured as temperature/humidity sensor.  Supported sensor's include DHT22 and
YL-69 Soil Moisture Sensor.  Also supports auto device discovery using MDNS,
removing the need to hard code device ip address in the configuration file.

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install homebridge-mcuiot using: npm install -g homebridge-mcuiot
3. Update your configuration file, see sample-config.json in this directory.
4. Install nodemcu-dht-yl69-mdns on your Nodemcu devices, and connect a DHT22
Temperature/Humidity and YL-69 Soil Moisture sensors.  See
https://github.com/NorthernMan54/nodemcu-dht-yl69-json-mdns for details on the
NodeMCU build and configuration.

# Configuration

```

    "bridge": {
        "name": "Bart",
        "username": "CC:22:3D:E3:CD:39",
        "port": 51826,
        "pin": "031-45-154"
    },

    "description": "HomeBridge",

"platforms": [
	{ "platform":	"mcuiot" }
	 ],

"accessories": [ ]

}
```
