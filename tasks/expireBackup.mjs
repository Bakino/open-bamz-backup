export default async function(payload, {query, logger, appName, io}){
    logger.info(`Start expire backup ${payload.backupId}`)
    try{
        let result = await query(`SELECT * FROM backup.backup WHERE _id = $1`, [payload.backupId])
        if(result.rows.length === 0){
            logger.error(`Backup ${payload.backupId} not found`);
            return;
        }
        let backup = result.rows[0];
        if(backup.status === "done"){
            let resultUpdate = await query(`UPDATE backup.backup SET status = 'expired' WHERE _id = $1 RETURNING *`, [payload.backupId]);

            await query(`INSERT INTO backup.backup_log(backup_id, type, message) VALUES ($1, $2, $3)`, 
                [payload.backupId, "expire", "Backup expired"]);
            io().to(`${appName}-backup`).emit("backup-updated", resultUpdate.rows[0]);
        }
    }catch(err){
        logger.error(`Error while perform backup ${payload.backupId} : %o`, err);
    }
}