#!/bin/zsh

THING="registry.fly.io/aionary-gamews:latest"
docker build . -t $THING
docker push $THING