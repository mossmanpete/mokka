import eventTypes from '../../shared/constants/EventTypes';
import {MessageApi} from '../api/MessageApi';
import {NodeApi} from '../api/NodeApi';
import messageTypes from '../constants/MessageTypes';
import states from '../constants/NodeStates';
import {Mokka} from '../main';

class TimerController {

  private mokka: Mokka;
  private timers: Map<string, NodeJS.Timer>;
  private messageApi: MessageApi;
  private nodeApi: NodeApi;

  constructor(mokka: Mokka) {
    this.mokka = mokka;
    this.timers = new Map<string, NodeJS.Timer>();
    this.messageApi = new MessageApi(mokka);
    this.nodeApi = new NodeApi(mokka);
  }

  public heartbeat(duration: number = this.mokka.heartbeat): void {

    if (this.timers.has('heartbeat')) {
      clearTimeout(this.timers.get('heartbeat'));
    }

    const heartbeatFunc = async (durationPassed, started) => {

      if (states.LEADER !== this.mokka.state) {
        this.mokka.emit(eventTypes.HEARTBEAT_TIMEOUT);
        console.log(`(${this.mokka.publicKey.slice(0, 5)}) haven't recieved any acks for ${durationPassed} (${Date.now()})`);
        this.mokka.setState(states.FOLLOWER, this.mokka.term, null, null);
        return await this.nodeApi.promote();
      }

      console.log(`(${this.mokka.publicKey.slice(0, 5)}) sending heartbeat ${Date.now()} with duration ${durationPassed} vs ${Date.now() - started}`);
      for (const node of this.mokka.nodes.values()) {
        const packet = await this.messageApi.packet(messageTypes.ACK, node.publicKey);
        await this.messageApi.message(packet); // todo this cause delay in heartbeat
      }

      this.timers.delete('heartbeat');
      this.heartbeat(this.mokka.heartbeat);
    };

    const heartbeatTimeout = setTimeout(heartbeatFunc.bind(this, duration, Date.now()), duration);

    this.timers.set('heartbeat', heartbeatTimeout);
  }

  public clearHeartbeatTimeout(): void {
    if (!this.timers.has('heartbeat'))
      return;

    clearTimeout(this.timers.get('heartbeat'));
    this.timers.delete('heartbeat');
  }

  public timeout() {
    // return _.random(this.beat, parseInt(this.beat * 1.5)); //todo use latency

    return this.mokka.heartbeat * 1.2 + Math.round((this.mokka.heartbeat * 0.5) * Math.random());
  }

}

export {TimerController};
