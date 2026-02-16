# The data exchange protocol for sending stuff to the digimini from an app


The digimini exports a BTLE service and characteristics.
UUIDs for these are all of the form

`D191D191-F070-(word1)-(word2)-B1EA550C1A7E`

The service is side-code (so "D191D191-F070-51DE-C0DE-B1EA550C1A7E").

In here, the "client" is always the app which runs on someone's phone or computer. The "device" or "server" is the digimini.

It has three characteristics:

* client2device cmd: this is used to send commands from the app to the device. UUID code: **feed-idea** (`FEED-1DEA`)
* client2device data: this is used to send data from the app to the device, once agreed to do so by a command. UUID code: **feed-data** (`FEED-DA7A`)
* device2client: used to send acknowledgements, responses, and checksums from device to client. UUID code: **accesses** (`ACCE-55E5`)

To do anything, the client has to first connect via BTLE.

To initiate a communication, the client sends a **command string** to the `client2device cmd` characteristic. Command strings always start `dmcmd:` and are strings: come in various flavours; each is responded to differently.

## `dmcmd:send_data:(blocks)`

This indicates that the app wants to send data in 20-character blocks. The number of such blocks is included. Once this send is acknowledged, the app should send 20-character blocks with acknowledgement one after the other to the device, checking the checksum after each block.

Only one data transmission can be done at a time. If a `dmcmd:send_data` arrives while there is already a transmission open (perhaps because the message to close it never arrived) then it will be rejected (how?)

Both sides start calculating a checksum. The checksum is a string of three comma-separated numbers: the first is the sum of each byte value of the transmitted data so far, mod 256; the second is the total length of (sent/received) data so far in bytes, mod 256; the third is the number of blocks received. So the checksum is `dmcs:(sum),(len),(blockcount)`

After each block is transmitted, the app should wait for the updated checksum to appear on the device2client characteristic and check its value. If the value is correct, proceed to the next block. If the value is incorrect, abort the transmission. (There is no provision for retransmitting blocks, yet.)

The device should respond with a `dmres:goahead` message on device2client.

## `dmcmd:abort_data`

Aborts the current open data transmission; the device should discard all sent data in this transmission and be prepared to receive new send_data commands.

## `dmcmd:end_data`

Sent after the last block is sent and its checksum acknowledged correctly, to indicate that both sides know that the transmission completed successfully.


