const config = require('config');
const allowMultiReg = config.has('options.multiple-registrations')  &&
  config.get('options.multiple-registrations') === true;

class Registrar {

  constructor(logger) {
    this._logger = logger;
    this.users = new Map() ;
    this.transactions = new Map() ;
  }

  get logger() {
    return this._logger;
  }

  addUserFlow(user, obj) {
    const {instanceId, regId} = obj;
    const key = makeFlowKey(instanceId, regId);
    const userFlows = this.users.get(user) || new Map();
    if (!allowMultiReg) userFlows.clear();
    userFlows.set(key, obj);
    this.users.set(user, userFlows) ;
  }

  removeUserFlow(user, {instanceId, regId}) {
    const key = makeFlowKey(instanceId, regId);
    const userFlows = this.users.get(user);
    if (userFlows) {
      userFlows.delete(key);
      this.users.set(user, userFlows);
    }
  }

  hasUser(user) {
    return this.users.has(user) && this.users.get(user).size > 0;
  }

  getUserFlows(user) {
    return Array.from(this.users.has(user) ? this.users.get(user).values() : []);
  }

  addTransaction(obj) {
    this.transactions.set(obj.aCallId, obj) ;
  }

  getNextCallIdAndCSeq(callid) {
    const obj = this.transactions.get(callid) ;
    if (obj) {
      const arr = /^(\d+)\s+(.*)$/.exec(obj.bCseq) ;
      if (arr) {
        obj.bCseq = (++arr[1]) + ' ' + (arr[2]);
        return {
          'Call-Id': obj.bCallId,
          'CSeq': obj.bCseq
        };
      }
    }
  }

  hasTransaction(callid) {
    return this.transactions.has(callid) ;
  }

  removeTransaction(callid) {
    this.transactions.delete(callid);
  }
}

module.exports = Registrar ;

function makeFlowKey(instanceId, regId) {
  return `${instanceId}::${regId}`;
}
