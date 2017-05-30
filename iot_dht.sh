#! /bin/sh

for i in `avahi-browse  -p -t _dht22._tcp | awk -F\; '{ print $4 }'`
do 
wget -O - http://$i.local./ | /usr/bin/logger -t iotDHT22 
done 2>/dev/null
