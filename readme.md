# Digimini on the nRF52840 dongle with micropython

we're using micropython ports/zephyr, not ports/nrf, because ports/nrf 
only has ubluepy which is bobbins.

Consider https://github.com/russhughes/st7789_mpy for the screen when 
we get there.

Run `bash setup.sh` to build micropython and install it on the dongle.

Our app is in `app`; `/app/server` is the stuff that runs on the dongle
(a python app); deploy it to the dongle (once it's got micropython on it)
with `bash deploy.sh`.
`app/client` is the web app which is the client and can send files and so on.
