'use strict' ;


class Registrar {

  constructor() {
    this.users = new Map() ;
    this.transactions = new Map() ;
  }

  addUser( user, obj ) {
    this.users.set( user, obj ) ;
  }

  removeUser( user ) {
    this.users.delete( user )  ;
  }

  hasUser( user ) {
    return this.users.has( user ) ;
  }

  getUser( user ) {
    return this.users.get( user ) ;

  }

  addTransaction( c ) {
    this.transactions.set(c.aCallId, c) ;
  }

  getNextCallIdAndCSeq( callid ) {
    var obj = this.transactions.get(callid) ;
    if( obj ) {
      var arr = /^(\d+)\s+(.*)$/.exec( obj.bCseq ) ;
      if( arr ) {
        obj.bCseq = (++arr[1]) + ' ' + (arr[2] ) ;
        return {
          'Call-Id': obj.bCallId,
          'CSeq': obj.bCseq 
        };
      }
    }    
  }

  hasTransaction( callid ) {
    return this.transactions.has(callid) ;
  }

  removeTransaction( callid ) {
    this.transactions.delete( callid ) ;    
  }
} 

module.exports = exports = Registrar ;
 