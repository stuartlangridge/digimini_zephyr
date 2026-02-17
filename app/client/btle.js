
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
        const BLOCK_SIZE = 240; // must be smaller than MTU
        for (let i=0; i<options.data.length; i+=BLOCK_SIZE) {
            const bytes = new TextEncoder().encode(options.data.substr(i, BLOCK_SIZE));
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
        
        const INITIAL_BURST_SIZE = 20;     // Start tiny! Increase only after success
        const MAX_BURST_SIZE = 120;
        const BASE_BURST_SIZE = 10;
        const INTER_WRITE_DELAY_MS = 0;
        const BURST_TIMEOUT_MS = 15000;

        let sentBlocks = 0;
        let lastKnownDeviceBlocks = 0;     // Track last reported progress
        let localSum = 0;
        let localLen = 0;

        while (sentBlocks < this.blocks.length) {
            let burstSize = Math.min(BASE_BURST_SIZE + Math.floor(sentBlocks / 20), 40); // ramp to 40 blocks = 8 kB bursts
            const thisBurst = Math.min(burstSize, this.blocks.length - sentBlocks);

            console.log(`Burst attempt: blocks ${sentBlocks + 1} → ${sentBlocks + thisBurst} (size ${thisBurst})`);

            for (let i = 0; i < thisBurst; i++) {
                const block = this.blocks[sentBlocks + i];
                for (let byte of block) localSum = (localSum + byte) % 256;
                localLen = (localLen + block.length) % 256;

                await this.bt.chars.us2server_data.writeValueWithoutResponse(block);
                await new Promise(r => setTimeout(r, INTER_WRITE_DELAY_MS));
            }

            sentBlocks += thisBurst;
            const previousProgress = lastKnownDeviceBlocks;
            await this.send_dmcmd("request_cs");
            try {
                lastKnownDeviceBlocks = await this.waitForAnyChecksumProgress(
                    previousProgress,
                    sentBlocks,
                    BURST_TIMEOUT_MS);
                console.log(`Progress OK: device reports >= ${lastKnownDeviceBlocks} blocks`);
            } catch (e) {
                console.error("Burst failed:", e);
                if (lastKnownDeviceBlocks > previousProgress) {  // some progress
                    console.log("Partial progress; continuing cautiously");
                    // proceed to next burst without throw
                } else {
                    console.error("No progress at all in this burst → likely full stall");
                    throw e;  // full stall → abort
                }
            }

            this.handlers.progress(sentBlocks / this.blocks.length, Date.now() - startTime);
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

    async waitForAnyChecksumProgress(previousBlocks, currentSentBlocks, timeoutMs) {
        const start = Date.now();
        let highestSeen = previousBlocks;

        while (Date.now() - start < timeoutMs) {
            if (this._mostRecentServerReply?.startsWith('dmcs:')) {
                const parts = this._mostRecentServerReply.split(':')[1].split(',');
                const sum = parseInt(parts[0]);
                const len = parseInt(parts[1]);
                const blocks = parseInt(parts[2]);

                if (blocks > highestSeen) {
                    highestSeen = blocks;
                    console.log(`Device advanced to ${blocks} blocks (local sent: ${currentSentBlocks})`);
                }

                if (blocks >= currentSentBlocks - 60) {  // ← use the passed param
                    return highestSeen;
                }
            }
            await new Promise(r => setTimeout(r, 30));
        }

        console.warn(`Timeout. Last device progress: ${highestSeen}, expected ~${currentSentBlocks}`);
        throw new Error(`Timeout waiting for progress (last seen ${highestSeen}, need ~${currentSentBlocks})`);
    }

    async waitForChecksumProgress(minBlocks, timeoutMs) {
        const start = Date.now();
        let lastSeenBlocks = 0;
        while (Date.now() - start < timeoutMs) {
            if (this._mostRecentServerReply?.startsWith('dmcs:')) {
                const [, sum, len, blocksStr] = this._mostRecentServerReply.split(/[:,]/);
                const blocks = parseInt(blocksStr);
                if (blocks >= minBlocks) {
                    console.log(`Good progress: device at ${blocks} blocks`);
                    return;
                }
                if (blocks > lastSeenBlocks) lastSeenBlocks = blocks;  // track advancement
            }
            await new Promise(r => setTimeout(r, 40));  // faster polling
        }
        throw new Error(`Timeout waiting for checksum progress >= ${minBlocks}`);
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