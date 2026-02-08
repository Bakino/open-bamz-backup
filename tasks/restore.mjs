import { runRestore } from "../backupers.mjs";
import fs from "fs-extra";
import path from "path";

export default async function(payload, {query, logger, appName, io}){
    logger.info(`Start perform restore ${payload.restoreId}`)
    try{
        let result = await query(`SELECT * FROM backup.restore WHERE _id = $1`, [payload.restoreId])
        if(result.rows.length === 0){
            logger.error(`Restore ${payload.restoreId} not found`);
            return;
        }
        let restore = result.rows[0];
        if(restore.status !== "todo"){
            logger.error(`Restore ${payload.restoreId} not to do`);
            await query(`UPDATE backup.restore SET status = 'error', error = 'Restore status not to do' WHERE _id = $1`, [payload.restoreId]);
            return;
        }

        let timeoutId = setTimeout(() => {
            logger.error(`Timeout while perform restore ${payload.restoreId}`);
            query(`UPDATE backup.restore SET status = 'failed', error = 'Timeout' WHERE _id = $1`, [payload.restoreId]);
        } , 60 * 60 * 1000 /* 1 hour */);

        logger.info(`Restore ${payload.restoreId} start`);
        const startTime = new Date() ;
        let resultUpdate = await query(`UPDATE backup.restore SET status = 'inprogress', start_time = $2 WHERE _id = $1 RETURNING *`, [payload.restoreId, startTime]);
        await query(`INSERT INTO backup.restore_log(restore_id, type, message) VALUES ($1, $2, $3)`, 
        [payload.backupId, "start", "Restore start"]);
        io().to(`${appName}-backup`).emit("restore-updated", resultUpdate.rows[0]);

        //don't use await to handle the timeout
        runRestore({restore, appName, query, io, logger})
            .then(async (result) => {
                clearTimeout(timeoutId);
                logger.info(`Restore ${payload.restoreId} done %o`, result);
                try{
                    let resultUpdate = await query(`UPDATE backup.restore SET status = 'done', end_time = now() WHERE _id = $1 RETURNING *`, [payload.restoreId]);
                    await query(`INSERT INTO backup.restore_log(restore_id, type, message, data) VALUES ($1, $2, $3, $4)`, 
                        [payload.restoreId, "done", "Restore done", result]);
                    io().to(`${appName}-backup`).emit("restore-updated", resultUpdate.rows[0]);
                }catch(err){
                    logger.info(`Restore ${payload.restoreId} update failed %o`, err);
                }
            })
            .catch(async (err) => {
                clearTimeout(timeoutId);
                logger.error(`Error while perform restore ${payload.restoreId} : %o`, err);
                try{
                    let resultUpdate = await query(`UPDATE backup.restore SET status = 'failed', error = $1 WHERE _id = $2 RETURNING *`, [err.message, payload.restoreId]);
                    await query(`INSERT INTO backup.restore_log(restore_id, type, message, data) VALUES ($1, $2, $3, $4)`, 
                        [payload.backupId, "error", "Error while perform restore", {error: err.message}]);
                    io().to(`${appName}-backup`).emit("restore-updated", resultUpdate.rows[0]);
                }catch(err){
                    logger.info(`Restore ${payload.restoreId} update failed %o`, err);
                }
            }).finally(async () => {
                clearTimeout(timeoutId);
                try{
                    await fs.remove(path.join(process.env.DATA_DIR, "restore", appName, restore.type, restore._id))
                }catch(err){
                    logger.error(`Can't clean restore restore._id %o`, err) ;
                }
                logger.info(`End perform restore ${payload.restoreId}`)
            });
    }catch(err){
        logger.error(`Error while perform restore ${payload.restoreId} : %o`, err);
    }
}