const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

const trans_fields = "typeID quantity price timestamp type tFor clientID".split(" ");
function transaction(data) {
    [this['_'+f] = data[f] for each (f in trans_fields)];
}

transaction.prototype = {
    classDescription:       "EVE Online Wallet transaction",
    classID:                Components.ID("{17e1f782-60b6-4a7d-b610-0380d56019c9}"),
    contractID:             "@aragaer/eve/wallet/transaction;1",
    QueryInterface:         XPCOMUtils.generateQI([Ci.nsIEveWalletTransaction]),

    get typeID()    this._typeID,
    get quantity()  this._quantity,
    get price()     this._price,
    get timestamp() this._timestamp,
    get type()      this._type,
    get tFor()      this._tFor,
    get clientID()  this._clientID,
};

function WalletIntervalObserver(char_id) {
    this.char_id = char_id;
    this.start = Date.now();
    Services.obs.addObserver(this, 'eve-data', false);
    Services.obs.addObserver(this, 'eve-data-error', false);
}

WalletIntervalObserver.prototype = {
    char_id:        null,
    chainedTrans:   null,
    error:          false,
    observe:        function (aSubject, aTopic, aData) {
        if (aData != 'charwallettrans')
            return;

        //aSubject contains fetched data now. All we need is to get the date of the last item.
        var doc = aSubject.wrappedJSObject.doc;
        var aux = aSubject.wrappedJSObject.aux;

        // now it either has to be the same chain or if the chain has just started - same character
        if (aux.characterID != this.char_id || aux.beforeTransID != this.chainedTrans)
            return;

        // now we can assume it is the same chain. Proceed.
        switch (aTopic) {
        case 'eve-data':
            try {
                var row = doc.evaluate('/eveapi/result/rowset/row[last()]', doc, null, 0, null);
                res = row.iterateNext();
                this.chainedTrans = res.getAttribute('transactionID');
                acquired_start = Date.UTCFromEveTimeString(res.getAttribute('transactionDateTime'));
            } catch (e) {
                dump("Error in charwallettrans observer: "+e+"\n");
                real_start = 0;
            }

            var stm;

            try {
                var intervals = [];
                conn.beginTransaction();
                stm = gwm.getIntervalsStm2;
                stm.params.char_id = this.char_id;
                stm.params.start = acquired_start;
                stm.params.end = real_end;
                while (stm.step())
                    intervals.push({start:stm.row.start_time, end:stm.row.end_time});
                stm.reset();
                if (intervals.length > 1) {
                    stm = gwm.dropIntervalsStm2;
                    stm.params.start = acquired_start;
                    stm.params.end = real_end;
                    stm.params.char_id = this.char_id;
                    stm.execute();
                    stm.reset();
                }

                var new_start, new_end;
                if (intervals.length) {
                    // intervals[0] ends inside our new interval, last of intervals starts inside our array
                    // combine those
                    new_start = acquired_start < intervals[0].start ? acquired_start : intervals[0].start;
                    new_end = real_end < intervals[intervals.length-1].end ? real_end : intervals[intervals.length-1].end;
                } else {
                    new_start = acquired_start;
                    new_end = real_end;
                }

                stm = gwm.storeIntervalStm;
                stm.params.char_id = this.char_id;
                stm.params.start = acquired_start;
                stm.params.end = real_end;
                stm.execute();
                stm.reset();

                conn.commitTransaction();
            } catch (e) {
                dump("Error in wallettrans database operations: "+e+"\n");
                dump("Error in wallettrans database operations: "+conn.lastErrorString+"\n");
                conn.rollbackTransaction();
            } finally {
                stm.reset();
            }
            break;
        case 'eve-data-error':
            if (aux.error.length) {
                this.error = true;
                dump(aux.error+"\n");
            }
            break;
        default:
            dump("Huh?\n");
            break;
        }
    },
}

var gwm, conn, gEAR, gAM;
function walletman() {
    if (gwm)
        return;
    gEAR = Cc["@aragaer/eve/api-requester;1"].getService(Ci.nsIEveApiRequester);
    gAM = Cc["@aragaer/eve/auth-manager;1"].getService(Ci.nsIEveAuthManager);
    var db = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
    try {
        conn = db.getConnection();
        if (conn)
            wallet_init();
    } catch (e) {
        // do nothing
    }

    if (!conn)
        Services.obs.addObserver(this, 'eve-db-init', false);
    gwm = this;
}

walletman.prototype = {
    classDescription:       "EVE Online Wallet Manager",
    classID:                Components.ID("{daeea9e7-66e5-47d7-8117-f2a18d054790}"),
    contractID:             "@aragaer/eve/wallet/manager;1",
    QueryInterface:         XPCOMUtils.generateQI([Ci.nsIEveWalletManager, Ci.nsIObserver]),

    getTransactionsForChar: function (char, start_time, end_time, out) {
        var res = [];
        let stm = gwm.getIntervalsStm2;
        var intervals = [];
        try {
            stm.params.char_id = char.id;
            stm.params.start = start_time;
            stm.params.end = end_time;
            while (stm.step())
                intervals.push({start: stm.row.start_time, end: stm.row.end_time});
        } catch (e) {
            dump("GetTransactions for char "+char.id+": "+e+"\n");
        } finally {
            stm.reset();
        }

        var real_start;

        switch (intervals.length) {
        case 1:         // everything's within one interval and we got it cached
            real_start = Date.now();
            break;
        case 0:         // totally uncovered interval. Have to fetch it
            real_start = start_time;
            break;
        default:        // we've got some bits... since we can only fetch continuous intervals, fetch it from earliest end
            real_start = intervals[0].end_time;
            break;
        }

        dump("And now we have to fetch data from "+Date(start_time)+" to "+Date(real_start)+"\n");

        var tok = null;
        tok = gAM.getTokenForChar(char, Ci.nsEveAuthTokenType.TYPE_FULL);

        if (!tok) {
            out.value = 0;
            return res;
        }

        var observer = new WalletIntervalObserver();
        var real_end = observer.start;

        var aux = {wrappedJSObject:{
                userID:     tok.accountID,
                apiKey:     tok.apiKey,
                characterID:tok.characterID,
            }};

        dump(Date(observer.start)+" (acquired) vs "+Date(start_time)+" (target)\n");
        while (observer.start > start_time && !observer.error) {
            gEAR.refreshData('charwallettrans', aux);
            aux.beforeTransID = observer.chainedTrans;
            break; // TODO:temporary!
        }
        Services.obs.removeObserver(observer, 'eve-data');
        Services.obs.removeObserver(observer, 'eve-data-error');

        // Now all the data is in the database. Almost win!
        dump("Everything's in database. Proceed\n");

        let stm = gwm.getTransactionsStm;
        try {
            stm.params.char_id = char.id;
            stm.params.t_for = Ci.nsEveTransactionFor.TYPE_PERSONAL;
            stm.params.start = start_time;
            stm.params.end = end_time;
            while (stm.step())
                res.push(transaction.fromStmRow(stm.row));
        } catch (e) {
            dump(e.toString()+"\n");
            if (conn)
                dump(conn.lastErrorString+"\n");
        } finally {
            stm.reset();
        }

        out.value = res.length;
        return res;
    },

    observe:        function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            Services.obs.addObserver(this, 'eve-db-init', false);
            Services.obs.addObserver(this, 'eve-data', false);
            break;
        case 'eve-db-init':
            try {
                db = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
                conn = aSubject.QueryInterface(Ci.mozIStorageConnection);
                wallet_init();
            } catch (e) {
                dump(e.toString()+"\n");
                if (conn)
                    dump(conn.lastErrorString+"\n");
            }
            break;
        case 'eve-data':
            switch (aData) {
                case 'charwallettrans':
                case 'corpwallettrans':
                    process(aSubject);
                    return;
                default:
                    break;
            }
            break;
        default:
            break;
        }
    },

};

function wallet_init() {
    if (!conn.tableExists('wallet_transactions'))
        conn.createTable('wallet_transactions',
            'charID integer, clientID integer, typeID integer, price float, ' +
            'type char, timestamp integer, quantity integer, tFor char, ' +
            'primary key (charID, clientID, typeID, timestamp)');
    if (!conn.tableExists('wallet_cached_intervals'))
        conn.createTable('wallet_cached_intervals',
            'charID integer, start_time integer, end_time integer');
    gwm.getIntervalsStm = conn.createStatement("select start_time, end_time " +
            "from wallet_cached_intervals where charID=:char_id order by start_time;");
    gwm.getIntervalsStm2 = conn.createStatement("select start_time, end_time " +
            "from wallet_cached_intervals where charID=:char_id " +
            "and (start_time < :end or end_time > :start) " +
            "order by start_time;");
    gwm.dropIntervalsStm2 = conn.createStatement("delete " +
            "from wallet_cached_intervals where charID=:char_id " +
            "and (start_time <= :end or end_time >= :start)");
    gwm.storeIntervalStm = conn.createStatement("insert into wallet_cached_intervals " +
            "(charID, start_time, end_time) values (:char_id, :start, :end)");
    gwm.storeTransactionStm = conn.createStatement("replace into wallet_transactions " +
            "(charID, clientID, typeID, price, type, timestamp, quantity, tFor) " +
            "values (:char_id, :client, :type_id, :price, :type, :time, :quantity, :t_for);");
    gwm.getTransactionsStm = conn.createStatement("select " +
            "charID, clientID, typeID, price, type, timestamp, quantity, tFor " +
            "from wallet_transactions " +
            "where charID=:char_id and timestamp between :start and :end " +
            "and tFor=:t_for;");
}

const trTypeConversion = {
    buy:        Ci.nsEveTransactionType.TYPE_BUY,
    sell:       Ci.nsEveTransactionType.TYPE_SELL,
    personal:   Ci.nsEveTransactionFor.TYPE_PERSONAL,
    corporation:Ci.nsEveTransactionFor.TYPE_CORPORATION,
};

function process(data) {
    dump("Processind wallet transaction data in wallet.js\n");
    var rows, row;
    var doc = data.wrappedJSObject.doc;
    var aux = data.wrappedJSObject.aux;
    var chid = aux.characterID;

    let stm = gwm.storeTransactionStm;
    try {
        rows = doc.evaluate("/eveapi/result/rowset/row", doc, null, 0, null);
    } catch (e) {
        dump("error in AssetsCallback:"+e.toString()+"\n");
    }

    while (row = rows.iterateNext())
        try {
            stm.params.char_id = chid;
            stm.params.client = row.getAttribute("clientID");
            stm.params.type_id = row.getAttribute("typeID");
            stm.params.price = row.getAttribute("price");
            stm.params.type = trTypeConversion[row.getAttribute("transactionType")];
            stm.params.time = Date.UTCFromEveTimeString(row.getAttribute("transactionDateTime"));
            stm.params.quantity = row.getAttribute("quantity");
            stm.params.t_for = trTypeConversion[row.getAttribute("transactionFor")];
            stm.execute();
            stm.reset();
            dump("got transaction: "+row.getAttribute("transactionType")+" "+
                row.getAttribute("typeID")+" x"+row.getAttribute("quantity")+" on "+
                row.getAttribute("transactionDateTime")+"\n");
        } catch (e) {
            dump("wallet process:" + e.toString()+"\n");
            if (conn)
                dump(conn.lastErrorString+"\n");
        } finally {
            stm.reset();
        }
}

var components = [walletman, transaction];

if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule(components);

Date.UTCFromEveTimeString = function (str) {
    var d = str.split(/:| |-/);
    d[1]--; // Month

    return Date.UTC(d[0], d[1], d[2], d[3], d[4], d[5]);
}

transaction.fromStmRow = function (row) new transaction(row);

