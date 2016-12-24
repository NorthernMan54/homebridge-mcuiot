# homebridge-mcuiot

This is a homebridge platform plugin, supporting multiple ESP8266 / nodemcu device's
configured as remote sensor module.  Supported sensor's include DHT22, BME280
and YL-69 Soil Moisture Sensor.  Included is also monitoring of a garage door position
sensor. Also supports auto device discovery using mDNS,
removing the need to manage devices via the config.json file.

Full build instructions are included in my instructable http://www.instructables.com/id/Homebridge-MCU-IOT/

Also the YL-69 Moisture sensor will create a phantom "Leak Sensor", and will
trigger a Leak event when the amount of moisture detected crosses a defined threshold.

# Homekit Accessories Created
## DHT - Combination Temperature / Humidity Sensor
## BME - Combination Temperature / Humidity / barometric Pressure Sensor
## YL - Water Leak Sensor
## GD - Garage Door Opener - Only reporting on position

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install homebridge-mcuiot using: npm install -g homebridge-mcuiot
3. Update your configuration file, see sample-config.json in this directory.
4. Install nodemcu-dht-yl69-mdns on your Nodemcu devices, and connect a DHT22 or BME280
Temperature/Humidity and YL-69 Soil Moisture sensors.  See
https://github.com/NorthernMan54/nodemcu-dht-yl69-json-mdns for details on the
NodeMCU build and configuration.

# Device management

## Adding devices

Devices are auto discovered using mDNS, and will add new devices when they appear
on mDNS.  In the event that devices are not discovered, restarting homebridge will
trigger a reconciliation between the plugin and mDNS, and add missing devices.
Missing devices are not removed during startup, see below for how to remove non-existent
devices.

## Removing devices

Devices are removed using the 'Identify Accessory' function.  When you use the
function from your app, it checks to see if the device is truly not responding
then removes the device.



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
	{ "platform":	"mcuiot",
    "name":     "MCUIOT" }
	 ],

"accessories": [ ]

}
```
## Optional parameters
- debug - Enables more verbose logging of sensor data, noisy
- refresh - Refresh rate in seconds for data, defaults to 60 seconds
- leak - Threshold for Moisture sensor to trigger leak detected, defaults to 10%
- port - Optional, port of web server to monitor devices, defaults to 8080


# Credits

- Homebridge communityTypes - Homespun and SphtKr
