export const idbRequest = request => new Promise((resolve,reject)=> {
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error??Error('REQUEST_FAILED'));
});
export const transactionDone = tx => new Promise((resolve,reject)=> {
  tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error('TRANSACTION_ABORTED'));tx.onerror=()=>{};
});
export async function transaction(db,names,mode,action) {
  const tx=db.transaction(names,mode),done=transactionDone(tx);
  try {const value=await action(tx);await done;return value;}
  catch(error) {try{tx.abort();}catch{/* already ended */}await done.catch(()=>{});throw error??Error('TRANSACTION_ABORTED');}
}
