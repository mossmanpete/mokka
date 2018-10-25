const _ = require('lodash'),
  messageTypes = require('../factories/messageTypesFactory'),
  states = require('../factories/stateFactory');

const append = async function (packet, write) { //todo move write to index.js

  if (packet.leader !== this.leader){
    //console.log('not a leader anymore')
    let reply = await this.actions.message.packet(messageTypes.ACK);
    return write(reply);
  }

  const {index, hash} = await this.log.getLastInfo();

  if ((packet.last.hash !== hash && packet.last.index === index) || (packet.last.hash === hash && packet.last.index !== index)) {//todo make rule for controlling alter-history (orphaned blocks)

    let prevTerm = await this.log.getLastEntryByTerm(this.term - 1);
    await this.log.removeEntriesAfter(prevTerm.index);

    let reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: prevTerm.index + 1});
    return this.actions.message.message(states.LEADER, reply);
  }

  if(!packet.data && packet.last.index > index){
    console.log(`[${Date.now()}]`, 'current log is', index, 'requesting ', index + 1, 'form leader: ', this.leader);
    let reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: index + 1, recursive: true});
    return write(reply);
  }


  if (packet.data) {

    packet.data = _.sortBy(packet.data, 'index');

    for (let entry of packet.data) {

      if (index >= entry.index) { //not next log to append
        console.log(`[${Date.now()}]master rewrite history[${this.index}]: ${index} -> ${entry.index}`);
        await this.log.removeEntriesAfter(entry.index - 1);
      }



      let reply = await this.actions.message.packet(messageTypes.APPEND_ACK, {
        term: entry.term,
        index: entry.index
      });

      try {
        await this.log.saveCommand(entry.command, entry.term, entry.index, entry.hash, entry.owner);
      } catch (err) {
        let {index: lastIndex, term} = await this.log.getLastInfo();
        console.log(`[${Date.now()}]error [${this.index}]`);

        if (err.code === 2) {
          let prevTermEntry = await this.log.getLastEntryByTerm(term - 1);
         // console.log(`[${Date.now()}]current term: ${term}, prev term: ${prevTermEntry.term}, received term: ${packet.last.term}`);
         // console.log(`[${Date.now()}]current index: ${index}, prev index: ${prevTermEntry.index}, received index: ${packet.last.index}`);
          console.log(`[${Date.now()}]dropping to previous term after commit: ${term} -> ${prevTermEntry.term}`);

          await this.log.removeEntriesAfter(prevTermEntry.index);

          reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: prevTermEntry.index + 1});
          return this.actions.message.message(states.LEADER, reply);
        }

        if (err.code === 3) {

          console.log(`[${Date.now()}]current log is[${this.index}]`, lastIndex, 'requesting ', lastIndex + 1, 'form leader: ', this.leader)
          reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: lastIndex + 1, recursive: true, lastIndex: entry.index});
          return this.actions.message.message(states.LEADER, reply);
        }

        reply = await this.actions.message.packet(messageTypes.APPEND_FAIL, {index: lastIndex});
        return this.actions.message.message(states.LEADER, reply);
      }


      write(reply);
    }
  }

  let reply = await this.actions.message.packet(messageTypes.ACK);
  write(reply);

};

const appendAck = async function (packet) {

  const entry = await this.log.commandAck(packet.data.index, packet.publicKey);
  if (this.quorum(entry.responses.length) && !entry.committed) {
    const entries = await this.log.getUncommittedEntriesUpToIndex(entry.index, entry.term);
    await this.commitEntries(entries);
  }

  this.emit(states.APPEND_ACK, entry.index);
};

const appendFail = async function (packet, write) {

    let {index} = await this.log.getLastInfo();

    if(packet.data.index > index){
      let reply = await this.actions.message.packet(messageTypes.ERROR, 'wrong index!');
      return write(reply);
    }



    let entity = packet.data.recursive ?
      packet.data.lastIndex ? await this.log.getEntriesAfter(packet.data.index - 1, packet.data.lastIndex - (packet.data.index - 1)) :
        await this.log.getEntriesAfter(packet.data.index - 1) :
      [await this.log.get(packet.data.index)];

  console.log(`[${Date.now()}]append fail[${this.index}]: requested - ${packet.data.index}, current: ${packet.last.index}, recursive: ${!!packet.data.recursive}, will send ${entity.length} items`);

  /*  if (packet.data.index !== previousEntry.index) {
      process.exit(0)
    }*/

/*  if(entity.length === 1){
    console.log(entity[0]);
    process.exit(0)
  }*/

  let reply = await this.actions.message.appendPacket(entity);
  return write(reply);
};

module.exports = (instance) => {

  _.set(instance, 'actions.append', {
    append: append.bind(instance),
    appendAck: appendAck.bind(instance),
    appendFail: appendFail.bind(instance)
  });

};