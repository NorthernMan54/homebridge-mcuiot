alt=320 -- altitude of the measurement place

config = require("config")

bme280.init(config.bme280sda,config.bme280scl)  -- bme280.init(sda, scl, 

P = bme280.baro()
print(string.format("QFE=%d.%03d", P/1000, P%1000))

-- convert measure air pressure to sea level pressure
QNH = bme280.qfe2qnh(P, alt)
print(string.format("QNH=%d.%03d", QNH/1000, QNH%1000))

H, T = bme280.humi()
print(string.format("T=%d.%02d", T/100, T%100))
print(string.format("humidity=%d.%03d%%", H/1000, H%1000))
D = bme280.dewpoint(H, T)
print(string.format("dew_point=%d.%02d", D/100, D%100))

-- altimeter function - calculate altitude based on current sea level pressure (QNH) and measure pressure
P = bme280.baro()
curAlt = bme280.altitude(P, QNH)
print(string.format("altitude=%d.%02d", curAlt/100, curAlt%100))
