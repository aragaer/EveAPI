const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function CharacterCallbackLoader() {
    var ear = Cc["@aragaer/eve/api-requester;1"].
            getService(Ci.nsIEveApiRequester);
    ear.addDataObserver("characters", function (doc, aux) {
        var res, result;
        var db = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
        var conn = db.connection;
        var replaceCharStm = conn.createStatement(
                'replace into characters (name, id, account, corporation) ' +
                'values (:name, :id, :acct_id, :corp_id);'
        );
        try {
            result = doc.evaluate('/eveapi/result/rowset/row', doc, null, 0, null);
        } catch (e) {
            dump("error in CharacterCallback\n");
        }
        while (res = result.iterateNext()) {
            replaceCharStm.params.acct_id   = aux.wrappedJSObject.userID;
            replaceCharStm.params.name      = res.getAttribute('name');
            replaceCharStm.params.id        = res.getAttribute('characterID');
            replaceCharStm.params.corp_id   = res.getAttribute('corporationID');
            replaceCharStm.execute();
            dump(res.getAttribute('name')+"\n");
        }
    });
}

CharacterCallbackLoader.prototype = {
    classDescription: "EVE API Character Registrar",
    classID:          Components.ID("{64a77750-4fad-4435-80de-7474b7a335d3}"),
    contractID:       "@aragaer/eve/characters/registrar;1",
    QueryInterface:   XPCOMUtils.generateQI([Ci.nsISupports]),
    _xpcom_categories: [{
        category: "app-startup",
    }],
}

var components = [CharacterCallbackLoader];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}
