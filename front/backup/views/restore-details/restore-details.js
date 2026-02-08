/* Javascript */

view.loader = async ()=>{
    const restore = await dbApi.db.backup.restore.getBy_id(view.route.params.id) ;

    const logs = await dbApi.db.backup.restore_log.search({ restore_id: view.route.params.id }, {orderBy: ["CREATE_TIME_ASC"]})

    return {
        restore, logs
    }
}