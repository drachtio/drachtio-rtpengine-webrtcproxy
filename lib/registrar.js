class Registrar {

  constructor(logger) {
    this._logger = logger;
    this.users = new Map() ;
    this.transactions = new Map() ;
  }

  get logger() {
    return this._logger;
  }

  addUser(user, obj) {
    this.users.set(user, obj) ;
  }

  removeUser(user) {
    this.users.delete(user)  ;
  }

  hasUser(user) {
    return this.users.has(user) ;
  }

  getUser(user) {
    return this.users.get(user) ;

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
