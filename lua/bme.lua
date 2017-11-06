local module = {}

function module.read()

  local alt = 320 -- altitude of the measurement place
  local device = bme280.init(config.bme280sda, config.bme280scl) -- bme280.init(sda, scl,
  local status, temp, humi, baro, dew

  if device == 2 then
    status = 0
    local T,P,H,QNH = bme280.read()
    while T == nil do
      tmr.delay(100)
      T,P,H,QNH = bme280.read()
    end

    baro = P / 1000
    temp = T / 100
    humi = H / 1000

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

  return status, temp, humi, baro, dew

end

return module
