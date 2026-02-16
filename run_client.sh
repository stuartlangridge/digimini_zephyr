#!/bin/bash

necho () {
  echo "########################################################################"
  printf '%s\n' "$1" | fold -s -w 72
  echo "########################################################################"
  tput sgr0;
}
cecho () {
  # green
  echo -en '\E[0;32m'
  necho "$@"
}
recho () {
  # red
  echo -en '\E[0;31m'
  necho "$@"
}
D=$(readlink -f $(dirname "$0"))

cecho "Running client webserver: go to http://localhost:5173"
cd "$D"/app/client
python -m http.server 5173
