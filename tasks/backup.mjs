import { runBackup } from "../backupers.mjs";

export default async function(payload, {query, logger, appName, io}){
    logger.info(`Start perform backup ${payload.backupId}`)
    try{
        let result = await query(`SELECT * FROM backup.backup WHERE _id = $1`, [payload.backupId])
        if(result.rows.length === 0){
            logger.error(`Backup ${payload.backupId} not found`);
            return;
        }
        let backup = result.rows[0];
        if(backup.status !== "todo"){
            logger.error(`Backup ${payload.backupId} not to do`);
            await query(`UPDATE backup.backup SET status = 'error', error = 'Backup status not to do' WHERE _id = $1`, [payload.backupId]);
            return;
        }

        let timeoutId = setTimeout(() => {
            logger.error(`Timeout while perform backup ${payload.backupId}`);
            query(`UPDATE backup.backup SET status = 'failed', error = 'Timeout' WHERE _id = $1`, [payload.backupId]);
        } , 60 * 60 * 1000 /* 1 hour */);

        logger.info(`Backup ${payload.backupId} start`);
        const startTime = new Date() ;
        let resultUpdate = await query(`UPDATE backup.backup SET status = 'inprogress', start_time = $2 WHERE _id = $1 RETURNING *`, [payload.backupId, startTime]);
        await query(`INSERT INTO backup.backup_log(backup_id, type, message) VALUES ($1, $2, $3)`, 
        [payload.backupId, "start", "Backup start"]);
        io().to(`${appName}-backup`).emit("backup-updated", resultUpdate.rows[0]);

        //don't use await to handle the timeout
        runBackup({backup, appName, query, io, logger})
            .then(async (result) => {
                clearTimeout(timeoutId);
                logger.info(`Backup ${payload.backupId} done %o`, result);
                try{
                    let resultUpdate = await query(`UPDATE backup.backup SET status = 'done', end_time = now(), file_path = $2 WHERE _id = $1 RETURNING *`, [payload.backupId, result.filePath]);
                    await query(`INSERT INTO backup.backup_log(backup_id, type, message, data) VALUES ($1, $2, $3, $4)`, 
                        [payload.backupId, "done", "Backup done", result]);
                    io().to(`${appName}-backup`).emit("backup-updated", resultUpdate.rows[0]);
                }catch(err){
                    logger.info(`Backup ${payload.backupId} update failed %o`, err);
                }
            })
            .catch(async (err) => {
                clearTimeout(timeoutId);
                logger.error(`Error while perform backup ${payload.backupId} : %o`, err);
                try{
                    let resultUpdate = await query(`UPDATE backup.backup SET status = 'failed', error = $1 WHERE _id = $2 RETURNING *`, [err.message, payload.backupId]);
                    await query(`INSERT INTO backup.backup_log(backup_id, type, message, data) VALUES ($1, $2, $3, $4)`, 
                        [payload.backupId, "error", "Error while perform backup", {error: err.message}]);
                    io().to(`${appName}-backup`).emit("backup-updated", resultUpdate.rows[0]);
                }catch(err){
                    logger.info(`Backup ${payload.backupId} update failed %o`, err);
                }
            }).finally(() => {
                clearTimeout(timeoutId);
                logger.info(`End perform backup ${payload.backupId}`)
            });
    }catch(err){
        logger.error(`Error while perform backup ${payload.backupId} : %o`, err);
    }
}