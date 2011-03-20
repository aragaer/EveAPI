const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function EveApiService() {
    this.requester = Cc["@aragaer/eve/api-requester;1"].
            getService(Ci.nsIEveApiRequester);
}

EveApiService.prototype = {
    classDescription: "EVE API XPCOM Component",
    classID:          Components.ID("{6f7ee12b-12b3-4101-a4c9-ecdc97c51421}"),
    contractID:       "@aragaer/eve-api;1",
    QueryInterface: XPCOMUtils.generateQI([Ci.nsIEveApiService]),
    _xpcom_categories: [{
        category: "xpcom-startup",
        service: true
    }],

    getServerStatus:    function () {
        this.requester.refreshData('serverStatus');
    },
    
    getCharacterList:   function (id, key) {
        this.requester.refreshData('characters', {wrappedJSObject: {userID: id, apiKey: key}});
    },

    getCharacterSkills: function (id, key, charID) {
        this.requester.refreshData('charsheet',
                {userID: id, apiKey: key, characterID: charID});
    },

    getCharacterAssets: function (id, key, charID, count) {
        this.requester.refreshData('charassets',
                {userID: id, apiKey: key, characterID: charID});
        count.value = result.length;
        return result;
    },

    updateCorporationAssets:    function (id, key, charID, corpID) {
        this.requester.refreshData('corpassets',
                { wrappedJSObject:
                    {userID: id, apiKey: key, characterID: charID, owner: corpID}
                });
    },
};

var components = [EveApiService];
if (XPCOMUtils.generateNSGetFactory)
    var NSGetFactory = XPCOMUtils.generateNSGetFactory(components);
else
    var NSGetModule = XPCOMUtils.generateNSGetModule(components);

