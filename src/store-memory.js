export class MemoryStore {
  constructor() {
    this.payloads = new Map();
  }

  async getPayload(channel) {
    return this.payloads.get(channel) || null;
  }

  async setPayload(channel, payload) {
    this.payloads.set(channel, payload);
  }
}
