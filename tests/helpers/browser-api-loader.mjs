import {readFile} from 'node:fs/promises';
export async function installBrowserTestAPI(page) {
  const session=await page.context().newCDPSession(page);
  try {
    const result=await session.send('Runtime.evaluate',{expression:await readFile('dist/test-support.mjs','utf8'),awaitPromise:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
  }finally{await session.detach();}
}
