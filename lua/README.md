# nodemcu-dht-yl69-mdns

LUA programs for a nodeMCU device to read various sensors and integrate into homebridge-mcuiot.  Sensors supported are DHT22 Temperature and Humidity Sensor, Bosch BME280 Temperatue, Humidty and Barometric and the YL-69 Soil Moisture Sensor.  Runs as a simple web server, that responds with sensor data formatted in JSON. Device discovery is done via MDNS, and advertises itself as a dht22 service.

JSON Response looks like this

{ "Hostname": "NODE-871ED8", "Model": "DHT", "Version": "1.1", "Data": {"Temperature": 23.7, "Humidity": 51.8, "Moisture": 1, "Status": 0 }}

or for a BME280

{ "Hostname": "NODE-8689D", "Model": "BME", "Version": "1.2", "Data": {"Temperature": 22.97, "Humidity": 48.341, "Moisture": 8, "Status": 0, "Barometer": 1008.512, "Dew": 11.49 }}

# Hardware

1. Bill of materials
   - nodeMCU / esp8266 dev kit
   - dht22 Temperature / Humidity Sensor
	Or
   - BME280 Bosch DIGITAL HUMIDITY, PRESSURE AND TEMPERATURE SENSOR
   - YL-69 Soil Moisture Sensor
   - 2N3904 Transistor
   - 1K Resister
   - ( Transistor and Resister only needed for Soil Moisture Sensor )

http://www.schematics.com/editor/nodemcu-dht22-yl-69-35878/

# nodeMCU Firmware

1. Using http://nodemcu-build.com, create a custom firmware containing at least
   these modules:

   adc,bme280,bit,dht,file,gpio,mdns,net,node,tmr,uart,wifi

2. Please use esptool to install the float firmware onto your nodemcu.  There are alot of guides for this, so I won't repeat it here.

# Configuration

1. WIFI Setup - Copy passwords_sample.lua to passwords.lua and add your wifi SSID and passwords.  Please note
   that the configuration supports multiple wifi networks, one per config line.
   ```
   module.SSID["SSID1"] = { ssid="SSID1", pwd = "password" }
   ```

2. Model - Used to determine which sensors are attached ( BME, DHT, YL, or GD)
   ```
   module.Model = "DHT"
   or
   module.Model = "DHT-YL"
   or
   module.Model = "BME"
   or
   module.Model = "BME-GD"
   ```

3.  

# Lua Program installation

1. Please use ESPlorer to install the lua files on the device.

2. Reboot your device

3. Output from boot via the serial console should look like this.

```
NodeMCU custom build by frightanic.com
	branch: master
	commit: cdaf6344457ae427d8c06ac28a645047f9e0f588
	SSL: false
	modules: adc,am2320,bit,dht,file,gpio,mdns,net,node,tmr,uart,wifi
 build 	built on: 2016-06-27 22:58
 powered by Lua 5.1.4 on SDK 1.5.1(e67da894)
Booting...
Setting Init Timer
Configuring Wifi ...
> Connecting to XXXXXXX ...
IP unavailable, Waiting...

====================================
ESP8266 mode is: 1
MAC address is: 5e:cf:7f:18:a6:b3
IP is 192.168.1.146
====================================
Registering service dht22 with mDNS
Web Server Started
```

4. To test the device, I use curl on OSX ie
```
curl 192.168.1.146
```
And see the following via the serial console.

```
GET / HTTP/1.1
Host: 192.168.1.146
User-Agent: curl/7.43.0
Accept: */*


Status: 0
Temp: 24.1
Humi: 49.3
Moisture: 1024
```
And curl outputs
```
{ "Hostname": "NODE-18A6B3", "Model": "DHT-YL", "Version": "1.0", "Data": {"Temperature": 24.3, "Humidity": 48.4, "Moisture": 1024, "Status": 0 }}
```

5. To test mDNS, I use this command on OSX
```
dns-sd -B _dht22._tcp
```
And for my 2 devices on the network, I receive the following output:
```
Browsing for _dht22._tcp
DATE: ---Mon 19 Sep 2016---
21:11:26.737  ...STARTING...
Timestamp     A/R    Flags  if Domain               Service Type         Instance Name
21:11:26.739  Add        3   4 local.               _dht22._tcp.         NODE-18A6B3
21:11:26.739  Add        2   4 local.               _dht22._tcp.         NODE-871ED8
```
