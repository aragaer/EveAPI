const Cc = Components.classes;
const Cr = Components.results;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

var gOS, gDB, gEIS;

const PreloadedItems = {};
const PreloadedTypes = {};
const PreloadedGroups = {};
const PreloadedCategories = {};

const ExtraQI = {
    'item': [], 'type': []
};

const IF = {
    getPreloaded:       function (storage, construct) {
        return function (id) {
            if (!storage['itm' + id])
                storage['itm' + id] = construct(id);
            return storage['itm' + id];
        }
    },

    getDataById:        function (obj, stmname) {
        return function (id) {
            var result = {};
            var stm = obj[stmname];
            try {
                stm.params.id = id;
                if (stm.step())
                    [result[col] = stm.row[col] for (col in columnList(stm))];
                else {/* No such object in our database */
                    dump("Object "+id+" not found in database with statement "+stmname+"\n")
                    return null;
                }
            } catch (e) {
                dump("error in "+stmname+"\n");
                dump(e.toString()+"\n");
            } finally {
                stm.reset();
            }
            return result;
        }
    },

    makeCategoryObject: function (id) new eveitemcategory(id),
    makeGroupObject:    function (id) new eveitemgroup(id),
    makeTypeObject:     function (id) new eveitemtype(id),
};
IF.getItemCategory  = IF.getPreloaded(PreloadedCategories, IF.makeCategoryObject);
IF.getItemGroup     = IF.getPreloaded(PreloadedGroups, IF.makeGroupObject);
IF.getItemType      = IF.getPreloaded(PreloadedTypes, IF.makeTypeObject);

const DataStatements = {
    getCatData:     'select categoryName from static.invCategories where categoryID=:id;',
    getGrpData:     'select groupName, categoryID from static.invGroups where groupID=:id;',
    getTypeData:    'select typeName, groupID from static.invTypes where typeID=:id;',
    getItemName:    'select itemName from eveNames where itemID=:id',
    setItemName:    'replace into eveNames (itemID, itemName, categoryID, groupID , typeID) ' +
            'values (:id, :name, :cat, :group, :type);',
    getStuffInside: 'select * from assets where container=:id',
    hasStuffInside: 'select count(*) as cnt from assets where container=:id',
    getSystemName:  'select solarSystemName as name from mapSolarSystems where solarSystemID=:loc_id;',
    getStationName: 'select stationName as name from staStations where stationID=:loc_id;',
};

function StmName(FuncName) "_"+FuncName+"Stm";

function eveitemcategory(catid) {
    this._id = catid;
    let {categoryName: name} = IF.getCatData(catid);
    this._name = name;
}

eveitemcategory.prototype = {
    classDescription:   "EVE item category",
    classID:            Components.ID("{ef3555fb-be5d-43c9-83ab-d3e8d5432f43}"),
    contractID:         "@aragaer/eve/item-category;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveItemCategory]),

    get id()            this._id,
    get name()          this._name,
};

function eveitemgroup(groupid) {
    this._id = groupid;
    let {groupName: name, categoryID: catid} = IF.getGrpData(groupid);
    this._name = name;
    this._category = IF.getItemCategory(catid);
}

eveitemgroup.prototype = {
    classDescription:   "EVE item group",
    classID:            Components.ID("{5e922507-10b0-4fee-b8df-9f95df29a28a}"),
    contractID:         "@aragaer/eve/item-group;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveItemGroup]),

    get id()            this._id,
    get name()          this._name,
    get category()      this._category,
};

function eveitemtype(typeid) {
    this._id = typeid;
    let {typeName: name, groupID: grpid} = IF.getTypeData(typeid);
    this._name = name;
    this._group = IF.getItemGroup(grpid);

    for each (ext in ExtraQI.type) {
        if (!ext.test(this))
            continue;
        ext.extend(this);
        this._interfaces.push(ext.idn);
    }
}

eveitemtype.prototype = {
    classDescription:   "EVE item type",
    classID:            Components.ID("{fb6bfcfe-5f16-4dc1-a78d-de5e4b766a26}"),
    contractID:         "@aragaer/eve/item-type;1",
    QueryInterface:     function (iid) {
        if (iid.equals(Ci.nsISupports) || iid.equals(Ci.nsIEveItemType))
            return this;

        for each (idn in this._interfaces)
            if (iid.equals(Ci[idn]))
                return this;

        throw Cr.NS_ERROR_NO_INTERFACE;
    },

    _interfaces:        [],

    get id()            this._id,
    get name()          this._name,
    get group()         this._group,
    get category()      this._group.category,
};

function getItemIdFromDataByCT(constructorType, data) {
    try {
    switch (constructorType) {
    case 'fromWrappedObject':
        data = data.wrappedJSObject;
    case 'fromObject':
        return data.id;
    case 'fromStm':
        return data.row.id;
    case 'fromRow':
        return data.QueryInterface(Ci.mozIStorageRow).getResultByName('id');
    default:
        return null;
    };
    } catch (e) {
        dump(e.toString()+"\n");
        dump("when getting id from "+data+" ("+constructorType+")\n");
        dump(data.wrappedJSObject+"\n");
        return null;
    }
}

function eveitem(constructorType, data) {
    switch (constructorType) {
    case 'fromWrappedObject':
        data = data.wrappedJSObject;
        /* fall-through */
    case 'fromObject':
        this._id        = data.id;
        this._location  = data.location;
        this._container = data.container;
        this._type      = IF.getItemType(data.type);
        this._quantity  = data.quantity;
        this._flag      = data.flag;
        this._singleton = data.singleton;
        this._childs    = null;
        break;
    case 'fromStm':
        this._id        = data.row.id;
        this._location  = data.row.location;
        this._container = null;
        this._type      = IF.getItemType(data.row.typeID);
        this._quantity  = data.row.count;
        this._flag      = data.row.flag;
        this._singleton = data.row.singleton;
        this._childs    = null;
        break;
    case 'fromRow':
        data            = data.QueryInterface(Ci.mozIStorageRow);
        this._id        = data.getResultByName('id');
        this._location  = data.getResultByName('location');
        this._container = null;
        this._type      = IF.getItemType(data.getResultByName('typeID'));
        this._quantity  = data.getResultByName('count');
        this._flag      = data.getResultByName('flag');
        this._singleton = data.getResultByName('singleton');
        this._childs    = null;
        break;
    default:
        dump("!! Unknown eveitem constructor type:"+constructorType+" !!\n");
        break;
    }

    let stm = IF._getItemNameStm;
    stm.params.id = this._id;
    try {
        if (stm.step())
            this._name = stm.row.itemName;
    } catch (e) {
        dump(e.toString()+"\n");
    } finally {
        stm.reset();
    }

    let stm = IF._hasStuffInsideStm;
    stm.params.id = this._id;
    try {
        stm.step();
        this._hasChilds = stm.row.cnt;
    } catch (e) {
        dump(e.toString()+"\n");
    } finally {
        stm.reset();
    }

    for each (ext in ExtraQI.item) {
        if (!ext.test(this, data))
            continue;
        ext.extend(this, data);
        this._interfaces.push(ext.idn);
    }
}

eveitem.prototype = {
    classDescription:   "EVE Item",
    classID:            Components.ID("{658ce840-ac50-4429-97bd-a68e9327b884}"),
    contractID:         "@aragaer/eve/item;1",
    QueryInterface:     function (iid) {
        if (iid.equals(Ci.nsISupports) || iid.equals(Ci.nsIEveItem))
            return this;

        for each (idn in this._interfaces)
            if (iid.equals(Ci[idn]))
                return this;

        throw Cr.NS_ERROR_NO_INTERFACE;
    },

    toString:           function () this._type.name,
    locationString:     function () locationToString(this._location),
    containerString:    function () {
        return this._container
            ? this._container.toString()
            : '';
    },
    _interfaces:    [],

    get id()        this._id,
    get location()  this._location,
    get container() this._container,
    get type()      this._type,
    get quantity()  this._quantity,
    get flag()      this._flag,
    get singleton() this._singleton,

    get group()     this._type.group,
    get category()  this._type.category,

    get name()      this._name,
    set name(name)  {
        if (this._name == name)
            return;
        this._name = name;
        let stm = IF._setItemNameStm;
        stm.params.id = this._id;
        stm.params.type = this._type.id;
        stm.params.group = this._type.group.id;
        stm.params.cat = this._type.group.category.id;
        stm.params.name = this._name;
        stm.executeAsync();
    },

    isContainer:        function () this._hasChilds,

    _fillChilds:        function () {
        if (!this._hasChilds || this._childs)
            return;
        this._childs = {};
        let stm = IF._getStuffInsideStm;
        stm.params.id = this._id;
        try {
            var childs = [];
            while (stm.step()) {
                var tmp = {};
                [tmp[col] = stm.row[col] for (col in columnList(stm))];
                childs.push({row:tmp});
            }
            [this._childs['itm'+i.row.id] = gEIS.createItem('fromStm', i) for each (i in childs)];
        } catch (e) {
            dump("Creating childs for "+this._id+": "+e+"\n");
        } finally {
            stm.reset();
        }
    },

    getItemsInside:     function (out) {
        out.value = 0;
        this._fillChilds();
        if (!this._childs)
            return [];
        var result = [i for each (i in this._childs)];
        out.value = result.length;
        return result;
    },

    addItem:            function (itm) {
        this._fillChilds();
        if (!this._childs)
            this._childs = {};
        if (!this._childs['itm' + itm.id])
            this._childs['itm' + itm.id] = itm;
    },

    removeItem:         function (itm) {
        this._fillChilds();
        this._childs.delete('itm' + itm.id);
    },
};

function eveinventory() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    gDB = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
    gEIS = this;
}

eveinventory.prototype = {
    classDescription:   "EVE Inventory Service",
    classID:            Components.ID("{e5dc59a4-217e-46da-8c9f-d6de36df2d3f}"),
    contractID:         "@aragaer/eve/inventory;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveInventoryService, Ci.nsIObserver]),
    _xpcom_categories:  [{
        category: "app-startup",
        service: true
    }],

    observe:            function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            gOS.addObserver(this, 'eve-db-init', false);
            for (i in DataStatements)
                IF[i] = IF.getDataById(IF, StmName(i));
            break;
        case 'eve-db-init':
            this._conn = gDB.getConnection();
            if (!this._conn.tableExists('assets'))
                this._conn.createTable('assets',
                        'id integer, typeID integer, owner integer, ' +
                        'location integer, count integer, flag integer, ' +
                        'singleton integer, container integer, primary key (id)');
            if (!this._conn.tableExists('eveNames'))
                this._conn.createTable('eveNames',
                        'itemID integer, itemName char, categoryID integer, ' +
                        'groupID integer, typeID integer, primary key (itemID)');

            for (i in DataStatements)
                try {
                    IF[StmName(i)] = this._conn.createStatement(DataStatements[i]);
                } catch (e) {
                    dump(e.toString()+"\n"+this._conn.lastErrorString+"\n");
                }
            break;
        }
    },

    getItemCategory:    IF.getItemCategory,
    getItemGroup:       IF.getItemGroup,
    getItemType:        IF.getItemType,

    createItem:         function (ct, data) {
        var id = getItemIdFromDataByCT(ct, data);
        if (!PreloadedItems['itm'+id] && id)
            PreloadedItems['itm'+id] = new eveitem(ct, data);
        return PreloadedItems['itm'+id];
    },

    addQI:              function (iname, obj) ExtraQI[iname].push(obj.wrappedJSObject),
};

var components = [eveinventory, eveitemcategory, eveitemgroup, eveitemtype, eveitem];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}

function columnList(stm) {
    for (let i = 0; i < stm.columnCount; i++)
        yield stm.getColumnName(i);
}

function locationToString(locationID) {
    var result, stm;
    switch (true) {
    case !locationID:
        return "";
    case locationID >= 66000000 && locationID < 67000000:
        locationID -= 6000001;
    case locationID >= 60000000 && locationID <= 61000000:
        stm = IF._getStationNameStm;
        break;

    case locationID >= 67000000 && locationID < 68000000:
        locationID -= 6000000;
    case locationID >= 60014860 && locatioID <= 60014929:
    case locationID >= 61000000:
        return "Some conquerable outpost";

    default:
        stm = IF._getSystemNameStm;
        break;
    };
    stm.params.loc_id = locationID;
    try {
        if (stm.step())
            result = stm.row.name;
        else
            result = "Unknown "+locationID;
    } catch (e) {
        dump(e.toString()+"\n");
    } finally {
        stm.reset();
    }
    return result;
}

