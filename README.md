# homebridge-mcuiot

This is a homebridge platform plugin, supporting multiple nodemcu device's configured as temperature/humidity sensor.  Supported sensor's include DHT22.

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install homebridge-mcuiot using: npm install -g homebridge-mcuiot
3. Update your configuration file, see sample-config.json in this directory.
4. Install nodemcu-dht-yl69-mdns on your Nodemcu devices, and connect a DHT22
Temperature/Humidity and YL-69 Soil Moisture sensors.  See nodemcu-dht-yl69-mdns
for details.

# Configuration

```

    "bridge": {
        "name": "Bart",
        "username": "CC:22:3D:E3:CD:39",
        "port": 51826,
        "pin": "031-45-154"
    },

    "description": "HomeBridge Heyu Status Control",


"platforms": [
	{ "platform":	"mcuiot" }
	 ],

"accessories": [ ]

}
```
