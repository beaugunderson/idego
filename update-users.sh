#!/bin/sh

cd /home/www/idego.co

/root/nvm/v0.8.8/bin/node siteUsers.js > public/users.json

cp public/users.json "data/`date +%s`.json"
