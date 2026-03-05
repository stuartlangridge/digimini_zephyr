
class BTLECachingInterface {
    /* 
    lets you call a function and await it rather than being driven by events
    caches images in localstorage
    */
    constructor() {
        this._btle = new BTLEManager({
            uuids: {
                service: "D191D191-F070-51DE-C0DE-B1EA550C1A7E".toLowerCase(),
                us2server_cmd: "D191D191-F070-FEED-1DEA-B1EA550C1A7E".toLowerCase(),
                us2server_data: "D191D191-F070-FEED-DA7A-B1EA550C1A7E".toLowerCase(),
                server2us: "D191D191-F070-ACCE-55E5-B1EA550C1A7E".toLowerCase(),
            }
        });
    }

    waitFor(options) {
        /* Pass options dict that looks like: {
            btle_manager_event: "btle-something", // this is the event that Manager fires
            method: this._btle.connect // this is what we call on Manager
            args: [list of, args to pass, to method],
            finalise: (detail) => { } // called with event.detail to alter it
        } */
        return new Promise((resolve, reject) => {
            // when the relevant event fires, return from waitFor with its detail
            const listener = event => {
                document.removeEventListener(options.btle_manager_event, listener);
                let detail = event.detail;
                if (options.finalise) detail = options.finalise(detail);
                resolve(detail);
            }
            document.addEventListener(options.btle_manager_event, listener);
            // and call the actual function in question
            options.method.call(this._btle, ...(options.args || [])).catch(e => { reject(e); });
        })
    }

    async getDevice(options) {
        return this.waitFor({
            btle_manager_event: "btle-connect",
            method: this._btle.connect, 
            args: [options]
        });
    }
    async getImagesMeta() {
        const results = await this.waitFor({
            btle_manager_event: "btle-server-sends",
            method: this._btle.send_dmcmd,
            args: ['get_image_meta']
        })
        const decoder = new TextDecoder();
        const text = decoder.decode(results.value);
        // response to dmcmd:get_image_meta is dmres:image_meta:filename,filename,filename
        // the filenames will be uuids, but that's not important
        if (!text.startsWith("dmres:image_meta:")) {
            console.log("WARNING, unexpected response to get_image_meta", text);
            return [];
        }
        const filenames = text.split(":")[2].split(",").filter(a => a.length > 0);
        const metas = filenames.map(filename => { return {name: filename} });
        return metas;
    }
    async getImageData(imageName) {
        // check cache for this, eventually
        const result = await this._btle.receive_from_command(`get_image:${imageName}`);
        console.log("got back imagedata", result);
        // convert it from 565 to png
        const as_png = await convert565ToPng(result.received);
        // cache this, eventually
        return as_png;
    }
    async deleteImage(imageName) {
        return this.waitFor({
            btle_manager_event: "btle-server-sends",
            method: this._btle.send_dmcmd,
            args: [`delete_image:${imageName}`]
        })
    }
    async disconnect() {
        return this.waitFor({
            btle_manager_event: "btle-disconnect",
            method: this._btle.disconnect
        });
    }
    async send(data_565, progress_cb) {
        console.log("send", data_565);
        function progress_handler(e) {
            progress_cb(e.detail.progress);
        }
        document.addEventListener("btle-progress-send", progress_handler)
        const promiseFinished = await this.waitFor({
            btle_manager_event: "btle-send-complete",
            method: this._btle.send,
            args: [data_565.buffer],
            finalise: data => {
                console.log("We got this back frmo a successful send", {data})
            }
        });
        document.removeEventListener("btle-progress-send", progress_handler)
        return promiseFinished;
    }
}

class BTLEManager {
    constructor(options) {
        this.uuids = options.uuids;
        this.connected = false;
        this._isDisconnecting = false;
        this.bt = null;
    }
    async _fire(eventName, detail) {
        const event = new CustomEvent(eventName, {
            bubbles: false,
            detail
        });
        document.dispatchEvent(event);
    }
    async _status(text) { this._fire("btle-status", {text}); }
    async connect() {
        if (this._isDisconnecting) {
            console.log("Can't connect while disconnecting");
            return;
        }
        console.log("conn: begin")
        try {
            this._status("Requesting device...");
            // we need acceptAllDevices here, even though it's really
            // annoying to show all devices rather than just ours,
            // because Chrome pretends that it can't find anything
            // quite often if you specify filters
            const device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true, 
                optionalServices: [this.uuids.service]
            });
            console.log("conn: add disco listener")
            this._unexpectedDisconnectReference = this._unexpectedDisconnect.bind(this);
            device.addEventListener('gattserverdisconnected',
                this._unexpectedDisconnectReference);
            this._status("Connecting...");
            console.log("conn: actually connecting")
            const server = await device.gatt.connect();
            this._status("Getting digimini service...");
            const service = await server.getPrimaryService(this.uuids.service);
            this.bt = {
                device,
                server,
                service,
                chars: {
                    us2server_cmd: await service.getCharacteristic(
                        this.uuids.us2server_cmd),
                    us2server_data: await service.getCharacteristic(
                        this.uuids.us2server_data),
                    server2us: await service.getCharacteristic(
                        this.uuids.server2us)
                },
                manager: this
            }
            console.log("conn: start notifications")
            this._status("Listening for server updates...");
            await this.bt.chars.server2us.startNotifications();
            this.onServerSendsRef = this.onServerSends.bind(this);
            console.log("conn: add charvaluechanged")
            this.bt.chars.server2us.addEventListener(
                "characteristicvaluechanged", this.onServerSendsRef);
            // Delay to let subscription stabilize
            await new Promise(r => setTimeout(r, 800));
            console.log("conn: connected")
            this._status("Connected");
            this.connected = true;
            this._fire("btle-connect", device);
        } catch (err) {
            this._status(`Connection failed: ${err.message || err}`, true);
            console.error("Connect error:", err);
            this.disconnect();
            throw err;
        }
    }
    async _unexpectedDisconnect() {
        if (this._isDisconnecting) return;
        console.log("Device disconnected unexpectedly", this);
        this.disconnect();
    }
    async onServerSends(event) {
        console.log("on server sends: got something")
        if (this.bt && this.blockSender) {
            this.blockSender.onServerSends(event.target.value);
        }
        if (this.bt && this.blockReceiver) {
            this.blockReceiver.onServerSends(event.target.value);
        }
        this._fire("btle-server-sends", {value: event.target.value})
    }
    async disconnect() {
        if (this._isDisconnecting) return;
        this._isDisconnecting = true;
        if (this.bt?.chars?.server2us) {
            this.bt?.chars?.server2us.removeEventListener(
                "characteristicvaluechanged", this.onServerSendsRef);
        }
        // need to stop notifications before disconnecting, otherwise they
        // don't work if you reconnect after disconnecting!
        await this.bt.chars.server2us.stopNotifications();
        if (this.bt?.server) {
            try { this.bt.server.disconnect(); } catch (e) { console.log("disco err", e); }
        }
        if (this.bt?.device && typeof this.bt?.device?.forget === "function") {
            this.bt.device.removeEventListener('gattserverdisconnected',
                this._unexpectedDisconnectReference);
            this.bt.device.forget().catch(e => console.warn("Forget failed:", e));
        }
        this.bt = null;
        this._status("Disconnected");
        this._isDisconnecting = false;
        this.connected = false;
        this._fire("btle-disconnect", {});
    }
    async send(data) {
        if (!this.connected) {
            console.log("Can't send, not connected");
            return;
        }
        this._status("Beginning send...");
        const start_send_time = new Date().getTime();
        this.blockSender = new BTLEBlockSender({
            data,
            handlers: {
                success: this._sendSuccess.bind(this),
                failure: this._sendFailure.bind(this),
                progress: this._sendProgress.bind(this)
            },
            bt: this.bt
        });
        await this.blockSender.start();
        return {elapsed_ms: new Date().getTime() - start_send_time,
            bytes_transferred: data.length}
    }
    async receive_from_command(cmd) {
        if (!this.connected) {
            console.log("Can't receive, not connected");
            return;
        }
        this._status("Beginning receive...");
        const start_receive_time = new Date().getTime();
        this.blockReceiver = new BTLEBlockReceiver({
            cmd,
            handlers: {
                success: this._receiveSuccess.bind(this),
                failure: this._receiveFailure.bind(this),
                progress: this._receiveProgress.bind(this)
            },
            bt: this.bt
        });
        const received = await this.blockReceiver.start();
        return {elapsed_ms: new Date().getTime() - start_receive_time,
            received}
    }

    async send_dmcmd(cmd) {
        const dmcmd = `dmcmd:${cmd}`;
        console.log(`Sending dmcmd "${dmcmd}"`);
        const bytes = new TextEncoder().encode(dmcmd);
        try {
            await this.bt.chars.us2server_cmd.writeValue(bytes);
            console.log(`Sent dmcmd (${bytes.length} bytes)`);
        } catch(err) {
            console.error(`Send error for ${dmcmd}`, err);
        }
    }

    async _sendSuccess(elapsed_ms, filename) {
        console.log("blocksender", "success");
        this._fire("btle-send-complete", {success: true, filename});
        this.blockSender = null;
        this._status("Sent successfully");
    }
    async _sendFailure() {
        console.log("blocksender", "failure");
        this._fire("btle-send-complete", {success: false});
        this.blockSender = null;
        this._status("Send failed");
    }
    async _sendProgress(progress, elapsed_ms) {
        console.log("blocksender", {progress, elapsed_ms})
        this._fire("btle-progress-send", {progress, elapsed_ms});
    }
    async _receiveSuccess(elapsed_ms) {
        console.log("blocksender", "success");
        this.blockReceiver = null;
        this._status("Received successfully");
    }
    async _receiveFailure() {
        console.log("blocksender", "failure");
        this.blockReceiver = null;
        this._status("Receive failed");
    }
    async _receiveProgress(progress, elapsed_ms) {
        console.log("blockreceiver", {progress, elapsed_ms})
        this._fire("btle-progress-receive", {progress, elapsed_ms});
    }
}

class BTLEBlockReceiver {
    constructor(options) {
        this.bt = options.bt;
        this.handlers = options.handlers;
        this.cmd = options.cmd;
        this.blocks = [];
        this.complete = false;
    }

    async start() {
        // returns the received thing
        // kick off the send with a dmcmd:get_image:(filename)
        await this.bt.manager.send_dmcmd(this.cmd);
        // and sit in a loop until it's done or we hit the timeout
        let total_time = 0;
        const loop_time = 250;
        const MAX_TOTAL_TIME_RECEIVE = 30000;
        while (true) {
            await new Promise(r => setTimeout(r, loop_time));
            if (this.complete) break;
            total_time += loop_time;
            if (total_time > MAX_TOTAL_TIME_RECEIVE) {
                console.log("ABORT ABORT ABORT RECEIVE");
                break;
            }
        }
        if (this.complete) {
            console.log("completed transfer");
            // glue together blocks and return
            let totalLength = 0;
            this.blocks.forEach(b => { totalLength += b.buffer.byteLength });
            let tmp = new Uint8Array(totalLength);
            let pointer = 0;
            this.blocks.forEach(b => {
                tmp.set(new Uint8Array(b.buffer), pointer);
                pointer += b.buffer.byteLength;
            });
            return tmp;
        }
        return null;
    }

    async onServerSends(data) {
        // digimini will break up the image into ~240 byte packets
        // and then send a "dmres:start_image_data:(total-size)" packet
        // then all the packets
        // then a "dmres:complete_image_data:(checksum)" packet
        
        // try decoding it as text; if it doesn't work, no problem
        let text;
        try {
            const decoder = new TextDecoder();
            text = decoder.decode(data);
        } catch(e) {}
        if (text && text.startsWith('dmres:image_data:')) {
            const parts = text.split(":");
            this.expected_size = parseInt(parts[2]);
        } else if (text && text.startsWith('dmres:complete_image_data:')) {
            const parts = text.split(":");
            this.expected_checksum = parseInt(parts[2]);
            this.complete = true;
        } else {
            this.blocks.push(data);
            console.log("got server data block", this.blocks.length);
        }
    }
}

class BTLEBlockSender {
    constructor(options) {
        this.bt = options.bt;
        this.handlers = options.handlers;
        this.filename = null;

        this.blocks = [];
        const BLOCK_SIZE = 240; // must be smaller than MTU
        let data = options.data;
        if (typeof data === 'string') {
            // Text → encode to UTF-8 bytes
            const encoder = new TextEncoder();
            data = encoder.encode(data);
        } else if (data instanceof ArrayBuffer) {
            // Accept ArrayBuffer directly
            data = new Uint8Array(data);
        } else if (!(data instanceof Uint8Array)) {
            throw new Error("send() expects string, Uint8Array or ArrayBuffer");
        }
        // Now data is definitely Uint8Array
        for (let i = 0; i < data.length; i += BLOCK_SIZE) {
            const chunk = data.subarray(i, i + BLOCK_SIZE);
            this.blocks.push(chunk);
        }
        console.log(`About to send ${this.blocks.length} blocks`);
    }

    async start() {
        const startTime = new Date().getTime();
        console.log("start sending", this.blocks.length, "blocks to", this.bt);
        await this.bt.manager.send_dmcmd(`send_data:${this.blocks.length}`);
        await this.waitForServerReply('dmres:goahead:');
        this.filename = this._mostRecentServerReply.split(":")[2];
        console.log("received server goahead for filename", this.filename);

        const blockSendTimes = [];
        let idx = 0;
        const CHECKSUM_EVERY_N_PACKETS = 20; // this must agree with digimini!
        for (const block of this.blocks) {
            console.log(`Sending block ${idx}/${this.blocks.length}`);
            const startBlockTime = new Date().getTime();
            await this.bt.chars.us2server_data.writeValue(block);
            blockSendTimes.push(new Date().getTime() - startBlockTime);
            console.log(`Sent block ${idx}/${this.blocks.length}`);
            this.handlers.progress(idx / this.blocks.length, Date.now() - startTime);
            idx += 1;
            if (idx % CHECKSUM_EVERY_N_PACKETS == 0) { // we need to look for checksums with the same interval that the digimini sends them
                while (true) {
                    console.log("Waiting for checksum, right now mrsr is", this._mostRecentServerReply);
                    let sum = -1, len = -1, count = -1;
                    // wait for checksum
                    let got_matching_checksum = false;
                    if (this._mostRecentServerReply) {
                        if (this._mostRecentServerReply.startsWith("dmcs:")) {
                            const parts1 = this._mostRecentServerReply.split(":");
                            if (parts1.length == 2) {
                                const parts = parts1[1].split(",");
                                sum = parseInt(parts[0]); len = parseInt(parts[1]); count = parseInt(parts[2]);
                                if (count == idx) {
                                    got_matching_checksum = true;
                                } else {
                                    console.log(`No checksum match: our count ${idx} != digimini count ${count}`);
                                }
                            } else {
                                console.log(`No checksum match: mrsr is bad ${this._mostRecentServerReply}`);
                            }
                        } else {
                            console.log(`No checksum match at our count ${idx}: most recent is ${this._mostRecentServerReply}`);
                        }
                    }
                    if (got_matching_checksum) {
                        console.log("Got matching checksum");
                        break;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
        let sumBlockTimes = 0;
        for (const bst of blockSendTimes) sumBlockTimes += bst;
        console.log(`Average block send time: ${Math.round(sumBlockTimes/blockSendTimes.length)}ms`);
        await this.bt.manager.send_dmcmd(`end_data`);
        console.log("all sent");
        this.handlers.success(Date.now() - startTime, this.filename);
    }

    async waitForServerReply(expected) {
        while (true) {
            if (this._mostRecentServerReply && this._mostRecentServerReply.startsWith(expected)) return true;
            await new Promise(r => setTimeout(r, 50));
        }
    }

    async onServerSends(data) {
        // data will be a dataview so decode it to text
        const decoder = new TextDecoder();
        const text = decoder.decode(data);
        console.log("bs from server", data, text);
        this._mostRecentServerReply = text;
    }

}
