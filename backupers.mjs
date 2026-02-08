let contextOfApp = null;

export function init({appContext}) {
    contextOfApp = appContext ;
}

export async function runBackup({appName, backup, query,  io, logger}) {
    let appContext = await contextOfApp(appName) ;
    let allBackupers = appContext.pluginsData["open-bamz-backup"]?.pluginSlots?.backupers??[] ;
    
    let backuper = allBackupers.find(t => t.type === backup.type) ;
    if(!backuper){
        throw new Error(`Backup ${backup.type} not found`) ;
    }
    return await backuper.backup({backup, appName, query, io, logger}) ;
}

export async function runRestore({appName, restore, query,  io, logger}) {
    let appContext = await contextOfApp(appName) ;
    let allBackupers = appContext.pluginsData["open-bamz-backup"]?.pluginSlots?.backupers??[] ;
    
    let backuper = allBackupers.find(t => t.type === restore.type) ;
    if(!backuper){
        throw new Error(`Restore ${restore.type} not found`) ;
    }
    return await backuper.restore({restore, appName, query, io, logger}) ;
}
