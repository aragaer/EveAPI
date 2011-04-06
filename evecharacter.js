const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
Components.utils.import("resource://gre/modules/Services.jsm");

var gCC;
var conn;
var replaceCharStm, replaceCorpStm;

function CharacterCallback() {
    if (!gCC)
        gCC = this;
}

CharacterCallback.prototype = {
    classDescription: "EVE API Character List Callback",
    classID:          Components.ID("{64a77750-4fad-4435-80de-7474b7a335d3}"),
    contractID:       "@aragaer/eve/callbacks/characters;1",
    QueryInterface:   XPCOMUtils.generateQI([Ci.nsIObserver]),

    observe:        function (aSubject, aTopic, aData) {
        dump('Got '+aTopic+' event in eve characters\n');
        switch (aTopic) {
        case 'app-startup':
            Services.obs.addObserver(this, 'eve-data', false);
            Services.obs.addObserver(this, 'eve-db-init', false);
            break;
        case 'eve-data':
            switch (aData) {
                case 'characters':
                    process(aSubject);
                    return;
                default:
                    break;
            }
            break;
        case 'eve-db-init':
            try {
                conn = aSubject.QueryInterface(Ci.mozIStorageConnection);
                replaceCharStm = conn.createStatement(
                    'replace into characters (name, id, account, corporation) ' +
                    'values (:name, :id, :acct_id, :corp_id);');
                replaceCorpStm = conn.createStatement(
                    'replace into corporations (name, id) values (:corp_name, :corp_id);');
            } catch (e) {
                dump("Error in eve characters: "+e+"\n");
            }
            break;
        }
    },
}

function process(data) {
    var res, result;
    var doc = data.wrappedJSObject.doc;
    var aux = data.wrappedJSObject.aux;
    dump("doc = ["+doc+"]\naux=["+aux+"]\n");
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
        replaceCharStm.params.acct_id   = aux.userID;
        replaceCharStm.params.name      = my_data.name;
        replaceCharStm.params.id        = my_data.characterID;
        replaceCharStm.params.corp_id   = my_data.corporationID;
        replaceCharStm.execute();
        replaceCorpStm.params.corp_name = my_data.corporationName;
        replaceCorpStm.params.corp_id   = my_data.corporationID;
        replaceCorpStm.execute();
    }
    Services.obs.notifyObservers(null, 'eve-characters-refresh', null);
}

var components = [CharacterCallback];
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule(components);
