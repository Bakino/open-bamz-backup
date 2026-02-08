/* Javascript */

view.loader = async ()=>{
    const backup = await dbApi.db.backup.backup.getBy_id(view.route.params.id) ;

    const logs = await dbApi.db.backup.backup_log.search({ backup_id: view.route.params.id }, {orderBy: ["CREATE_TIME_ASC"]})

    return {
        backup, logs
    }
}