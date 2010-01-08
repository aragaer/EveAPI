const Cc = Components.classes;
const Cr = Components.results;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

var gOS, gDB;

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
                stm.step();
                [result[col] = stm.row[col] for (col in columnList(stm))];
            } catch (e) {
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
};

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
//    this._name = EveDBService.getItemName(id);
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
    default:
        dump("!! Unknown eveitem constructor type:"+constructorType+" !!\n");
        break;
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

    toString:           function () this.type.name,
    locationString:     function () "",
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

    get name()      this._name,
    set name(name)  {
        return;
    },

    isContainer:        function () {
        return this._childs ? true : false;
    },

    getItemsInside:     function (out) {
        out.value = 0;
        if (!this._childs)
            return [];
        var result = this._childs.slice(0);
        out.value = result.length;
        return result;
    },

    addItem:            function (itm) {
        if (!this._childs)
            this._childs = {};
        if (!this._childs['itm' + itm.id])
            this._childs['itm' + itm.id] = itm;
    },

    removeItem:         function (itm) {
        this._childs.delete('itm' + itm.id);
    },
};

function eveinventory() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    gDB = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
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
                IF[StmName(i)] = this._conn.createStatement(DataStatements[i]);
            break;
        }
    },

    getItemCategory:    IF.getItemCategory,
    getItemGroup:       IF.getItemGroup,
    getItemType:        IF.getItemType,

    createItem:         function (ct, data) new eveitem(ct, data),

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

