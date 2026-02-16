const INTER_WRITE_DELAY_MS = 30;

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
            this._unexpectedDisconnectReference = this._unexpectedDisconnect.bind(this);
            device.addEventListener('gattserverdisconnected',
                this._unexpectedDisconnectReference);
            this._status("Connecting...");
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
                }
            }
            this._status("Listening for server updates...");
            await this.bt.chars.server2us.startNotifications();
            this.onServerSendsRef = this.onServerSends.bind(this);
            this.bt.chars.server2us.addEventListener(
                "characteristicvaluechanged", this.onServerSendsRef);
            // Delay to let subscription stabilize
            await new Promise(r => setTimeout(r, 800));
            this._status("Connected");
            this.connected = true;
            this._fire("btle-connect", {});
        } catch (err) {
            this._status(`Connection failed: ${err.message || err}`, true);
            console.error("Connect error:", err);
            this.disconnect();
        }
    }
    async _unexpectedDisconnect() {
        if (this._isDisconnecting) return;
        console.log("Device disconnected unexpectedly", this);
        this.disconnect();
    }
    async onServerSends(event) {
        if (this.bt && this.blockSender) {
            this.blockSender.onServerSends(event.target.value);
        } else {
            console.log("Unexpected server send", event.target.value);
        }
    }
    async disconnect() {
        if (this._isDisconnecting) return;
        this._isDisconnecting = true;
        if (this.bt?.chars?.server2us) {
            this.bt?.chars?.server2us.removeEventListener(
                "characteristicvaluechanged", this.onServerSendsRef);
        }
        if (this.bt?.server) {
            try { this.bt.server.disconnect(); } catch (e) {}
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

    async _sendSuccess(elapsed_ms) {
        console.log("blocksender", "success");
        this.blockSender = null;
        this._status("Sent successfully");
    }
    async _sendFailure() {
        console.log("blocksender", "failure");
        this.blockSender = null;
        this._status("Send failed");
    }
    async _sendProgress(progress, elapsed_ms) {
        console.log("blocksender", {progress, elapsed_ms})
        this._fire("btle-progress", {progress, elapsed_ms});
    }
}

class BTLEBlockSender {
    constructor(options) {
        this.bt = options.bt;
        this.blocks = [];
        for (let i=0; i<options.data.length; i+=20) {
            const bytes = new TextEncoder().encode(options.data.substr(i, 20));
            this.blocks.push(bytes);
        }
        this.handlers = options.handlers;
    }
    async start() {
        const startTime = new Date().getTime();
        console.log("start sending", this.blocks.length, "blocks to", this.bt);
        await this.send_dmcmd(`send_data:${this.blocks.length}`);
        await this.waitForServerReply('dmres:goahead');
        console.log("received server goahead");
        let cs_len = 0;
        let cs_sum = 0;
        for (let [index, block] of this.blocks.entries()) {
            cs_len += block.length;
            for (let i=0; i<block.length; i++) {
                cs_sum += block[i];
            }
            cs_len %= 256;
            cs_sum %= 256;
            const expected = `dmcs:${cs_sum},${cs_len},${index+1}`;
            console.log(`Sending block ${index} (${block.length}) to ${this.bt.chars.us2server_data}`);
            await this.bt.chars.us2server_data.writeValueWithoutResponse(block);
            await this.waitForServerReply(expected);
            console.log(`Blocks to ${index} sent OK`);
            this.handlers.progress(
                (index+1) / this.blocks.length,
                new Date().getTime() - startTime);
            await new Promise(r => setTimeout(r, INTER_WRITE_DELAY_MS));
        }
        await this.send_dmcmd(`end_data`);
        this.handlers.success();
    }
    async onServerSends(data) {
        // data will be a dataview so decode it to text
        const decoder = new TextDecoder();
        const text = decoder.decode(data);
        //console.log("bs from server", data, text);
        this._mostRecentServerReply = text;
    }
    async waitForServerReply(expected, timeout) {
        //console.log("Waiting for server reply", expected);
        const actual_timeout = timeout || 1000;
        const catchup_timeout = 10000;
        const startTime = new Date().getTime();
        while (true) {
            if (this._mostRecentServerReply == expected) {
                //console.log("got expected reply", expected);
                return;
            }
            //console.log(`Check server reply, want "${expected}", got "${this._mostRecentServerReply}"`);
            await new Promise(r => setTimeout(r, 50));

            if (new Date().getTime() - startTime > actual_timeout) {

                // if this is a checksum and we haven't got to ours yet, keep waiting
                if (expected.startsWith('dmcs:') && this._mostRecentServerReply.startsWith("dmcs:")) {
                    const block_count_expected = parseInt(expected.split(",")[2]);
                    const block_count_got = parseInt(this._mostRecentServerReply.split(",")[2]);
                    if (block_count_got < block_count_expected && 
                        new Date().getTime() - startTime < catchup_timeout) {
                        //console.log(`Waiting for ${expected} but we aren't there yet, at ${this._mostRecentServerReply}, extra time`);
                        continue;
                    } else if (this._mostRecentServerReply == expected) {
                        //console.log("got expected reply after extending timeout");
                        return;
                    }
                }
                throw new Error(`waitForServerReply timeout (${expected})`);
            }
        }
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
}