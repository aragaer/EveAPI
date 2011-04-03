const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

const fields = "typeID quantity price timestamp type tFor clientID".split(" ");
function transaction(data) {
    [this['_'+f] = data[f] for each (f in fields)];
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

var gwm, conn;
function walletman() {
    if (gwm)
        return;
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
        }

        var real_start;

        switch (intervals.length) {
        case 1:         // everything's within one interval and we got it cached
            real_start = now();
            break;
        case 0:         // totally uncovered interval. Have to fetch it
            real_start = start_time;
            break;
        default:        // we've got some bits... since we can only fetch continuous intervals, fetch it from earliest end
            real_start = intervals[0].end_time;
            break;
        }

        dump("And now we have to fetch data from "+real_start+" to "+end_time+"\n");

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
    gwm.getIntervalsStm2 =  conn.createStatement("select start_time, end_time " +
            "from wallet_cached_intervals where charID=:char_id " +
            "and (start_time < :end or end_time > :start) " +
            "order by start_time;");
}

function process(data) {
    dump("Processind wallet transaction data in wallet.js\n");
    var rowsets, rowset;
    var doc = data.wrappedJSObject.doc;
    var aux = data.wrappedJSObject.aux;
/*
    var replaceItemStm = this._conn.createStatement(
            'replace into assets (id, typeID, owner, location, count, ' +
            'flag, singleton, container) ' +
            'values (:id, :type_id, :owner, :location, :count, :flag, :singleton, :container);'
    );
    try {
        rowsets = doc.evaluate('/eveapi/result/rowset', doc, null, 0, null);
    } catch (e) {
        dump("error in AssetsCallback:"+e.toString()+"\n");
    }
    while (rowset = rowsets.iterateNext())
        this._processAssetList(aux.wrappedJSObject.owner, rowset, replaceItemStm, doc);
*/
}

var components = [walletman, transaction];

if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule(components);

