'use strict';
const {ArticleFetchError}=require('./article-transport');
function createArticleRequestPool({now=Date.now,maxEntries=256,maxConcurrent=8,perClientMinute=12,successTtl=600000}={}) {
  const positive=new Map(),negative=new Map(),pending=new Map(),clients=new Map();
  const set=(map,key,value)=>{map.delete(key);map.set(key,value);while(map.size>maxEntries)map.delete(map.keys().next().value);};
  function cached(map,key){const value=map.get(key);if(value?.until>now())return value;map.delete(key);return null;}
  async function run(key,client,load){
    const good=cached(positive,key);if(good)return good.data;
    const bad=cached(negative,key);if(bad)throw new ArticleFetchError(bad.code,{...bad,retryAfter:Math.max(1,Math.ceil((bad.until-now())/1000))});
    if(pending.has(key))return pending.get(key);
    if(pending.size>=maxConcurrent)throw new ArticleFetchError('reader_busy',{retryAfter:5});
    // Local abuse brake only. The relay's Durable Object owns the global cap.
    let bucket=clients.get(client);
    if(!bucket || bucket.until<=now())bucket={count:0,until:now()+60000};
    if(bucket.count>=perClientMinute)throw new ArticleFetchError('reader_rate_limited',{retryAfter:Math.ceil((bucket.until-now())/1000)});
    bucket.count++;set(clients,client,bucket);
    const promise=Promise.resolve().then(load).then(data=>{set(positive,key,{data,until:now()+successTtl});return data;}).catch(error=>{
      const e=error instanceof ArticleFetchError?error:new ArticleFetchError('source_unavailable');
      set(negative,key,{code:e.code,upstreamStatus:e.upstreamStatus,until:now()+Math.min(['source_rate_limited','reader_daily_limit'].includes(e.code)?86400:300,e.retryAfter)*1000});
      throw e;
    }).finally(()=>pending.delete(key));
    pending.set(key,promise);return promise;
  }
  return {run};
}
module.exports={createArticleRequestPool};
