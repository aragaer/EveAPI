const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
var gOS;

function CharacterCallback() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    this._conn = null;
}

CharacterCallback.prototype = {
    classDescription: "EVE API Character List Callback",
    classID:          Components.ID("{64a77750-4fad-4435-80de-7474b7a335d3}"),
    contractID:       "@aragaer/eve/callbacks/characters;1",
    QueryInterface:   XPCOMUtils.generateQI([Ci.nsIObserver]),
    _xpcom_categories: [{
        category:   'app-startup',
        service:    true
    }],

    observe:        function (aSubject, aTopic, aData) {
        dump('Got '+aTopic+' event in eve characters\n');
        switch (aTopic) {
        case 'app-startup':
            gOS.addObserver(this, 'eve-data', false);
            gOS.addObserver(this, 'eve-db-init', false);
            break;
        case 'eve-data':
            switch (aData) {
                case 'characters':
                    this._process(aSubject);
                    return;
                default:
                    break;
            }
            break;
        case 'eve-db-init':
            var db = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
            dump("DB service is initialized... store connection now\n");
            this._conn = db.getConnection();
            break;
        }
    },

    _process:       function (data) {
        var res, result;
        var doc = data.wrappedJSObject.doc;
        var aux = data.wrappedJSObject.aux;
        var replaceCharStm = this._conn.createStatement(
                'replace into characters (name, id, account, corporation) ' +
                'values (:name, :id, :acct_id, :corp_id);'
        );
        var replaceCorpStm = this._conn.createStatement(
                'replace into corporations (name, id) values (:corp_name, :corp_id);'
        );
        try {
            result = doc.evaluate('/eveapi/result/rowset/row', doc, null, 0, null);
        } catch (e) {
            dump("error in CharacterCallback\n");
        }
        while (res = result.iterateNext()) {
            dump("result:\n");
            var my_data = {};
            ['name', 'corporationID', 'characterID', 'corporationName'].
                forEach(function (field) {
                    my_data[field] = res.getAttribute(field);
                    dump(field + " = " + my_data[field]+"\n");
                });
            dump(my_data.name+" from "+my_data.corporationName+"\n");
            replaceCharStm.params.acct_id   = aux.wrappedJSObject.userID;
            replaceCharStm.params.name      = my_data.name;
            replaceCharStm.params.id        = my_data.characterID;
            replaceCharStm.params.corp_id   = my_data.corporationID;
            replaceCharStm.execute();
            replaceCorpStm.params.corp_name = my_data.corporationName;
            replaceCorpStm.params.corp_id   = my_data.corporationID;
            replaceCorpStm.execute();
        }
        gOS.notifyObservers(null, 'eve-characters-refresh', null);
    }
}

var components = [CharacterCallback];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}
