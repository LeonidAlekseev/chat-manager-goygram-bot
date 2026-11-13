#! /usr/bin/env sh

git pull
docker rm --force aiogram-chat-manager
make prod
make up-prod