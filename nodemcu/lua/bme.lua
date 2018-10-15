local module = {}

function module.read()

  local alt = 320 -- altitude of the measurement place
  i2c.setup(0,config.bme280sda, config.bme280scl,i2c.SLOW)
  local device = bme280.setup()
  local status, temp, humi, baro, barol, dew

  if device == 2 then
    status = 0
    local T,P,H,QNH = bme280.read(alt)
    while T == nil do
      tmr.delay(100)
      T,P,H,QNH = bme280.read()
    end
    
    baro = QNH / 1000
    temp = T / 100
    humi = H / 1000
    barol = P / 1000

    local D = bme280.dewpoint(H, T)
    dew = D / 100

  else

    if device == nil then
      status = 2
    else
      status = 1
    end
    print( "BME280 Read Error %d", device )

  end

  return status, temp, humi, baro, barol, dew

end

return module
