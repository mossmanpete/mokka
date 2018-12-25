const _ = require('lodash'),
  states = require('../factories/stateFactory'),
  messageTypes = require('../factories/messageTypesFactory'),
  ProofValidationService = require('./proofValidationService');


class RequestProcessor {

  constructor (mokka) {
    this.mokka = mokka;
    this.proofValidation = new ProofValidationService(mokka);
  }


  async process (packet) {

    let reply;

    if (!_.isObject(packet)) {
      let reason = 'Invalid packet received';
      this.mokka.emit(messageTypes.ERROR, new Error(reason));
      let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, reason);
      return {
        reply: reply,
        who: packet.publicKey
      };
    }

    this.mokka.heartbeat(states.LEADER === this.mokka.state ? this.mokka.beat : this.mokka.timeout());

    if (packet.type === messageTypes.APPEND) {

      if (!packet.proof) {

        let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
        return {
          reply: reply,
          who: packet.publicKey
        };
      }

      let validated = await this.proofValidation.validate(packet.term, packet.proof, packet.data); //todo fix

      if (!validated) {
        let reply = await this.mokka.actions.message.packet(messageTypes.ERROR, 'validation failed');
        return {
          reply: reply,
          who: packet.publicKey
        };
      }

      this.mokka.change({
        leader: states.LEADER === packet.state ? packet.publicKey : packet.leader || this.mokka.leader,
        state: states.FOLLOWER,
        term: packet.term
      });
    }

    if (packet.type === messageTypes.VOTE)  //add rule - don't vote for node, until this node receive the right history (full history)
      reply = await this.mokka.actions.vote.vote(packet);


    if (packet.type === messageTypes.VOTED)
      reply = await this.mokka.actions.vote.voted(packet);


    if (packet.type === messageTypes.ERROR)
      this.mokka.emit(messageTypes.ERROR, new Error(packet.data));


    if (packet.type === messageTypes.APPEND)
      reply = await this.mokka.actions.append.append(packet);


    if (packet.type === messageTypes.APPEND_ACK)
      reply = await this.mokka.actions.append.appendAck(packet);

    if (packet.type === messageTypes.APPEND_FAIL)
      reply = await this.mokka.actions.append.appendFail(packet);

    if (packet.type === messageTypes.RE_APPEND)
      reply = await this.mokka.actions.append.obtain(packet);


    if (!Object.values(messageTypes).includes(packet.type)) {
      let response = await this.mokka.actions.message.packet('error', 'Unknown message type: ' + packet.type);
      reply = {
        reply: response,
        who: packet.publicKey
      };
    }

    this.mokka.heartbeat(states.LEADER === this.mokka.state ? this.mokka.beat : this.mokka.timeout());


    let {index} = await this.mokka.log.getLastInfo();

    //let validateLogSent = this.mokka.cache.get(`requests.${packet.publicKey}.${packet.last.index + 1}`);
    //if (!validateLogSent && this.mokka.state !== states.LEADER && packet.type === messageTypes.ACK && packet.last && packet.last.index > index && packet.last.createdAt < Date.now() - this.mokka.beat) {
    if (this.mokka.state !== states.LEADER && packet.type === messageTypes.ACK && packet.last && packet.last.index > index && packet.last.createdAt < Date.now() - this.mokka.beat) {

      let response = await this.mokka.actions.message.packet(messageTypes.RE_APPEND);
      reply = {
        reply: response,
        who: packet.publicKey
      };
    }

    return reply;

  }

}


module.exports = RequestProcessor;
