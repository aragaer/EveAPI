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
        var result = [];
        count.value = result.length;
        return result;
    },
};

var components = [EveApiService];
function NSGetModule(compMgr, fileSpec) {
    dump('service getmodule\n');
    return XPCOMUtils.generateModule(components);
}

function processCharassets(data) {
    var rows = evaluateXPath(data, "//row");
    if (!ItemBuilder)
        ItemBuilder = Cc["@aragaer/eve/item-builder;1"].
                getService(Ci.nsIEveItemBuilder);
    dump("Found "+rows.length+" items\n");
    return rows.map(function (item) {
        return ItemBuilder.createItem(
            item.getAttribute('itemID'),
            item.hasAttribute('locationID')
                ? item.getAttribute('locationID')
                : item.parentNode.parentNode.getAttribute('itemID'),
            item.getAttribute('typeID'),
            item.getAttribute('quantity'),
            item.getAttribute('flag'),
            item.getAttribute('singleton')
        );
    });
}

