import {AnalysisEngine} from '../../src/analysis/engine.mjs';
import {MaintenanceDispatcher} from '../../src/analysis/maintenance.mjs';
import {PathClient} from './client.mjs';
export function workerPath(client=new PathClient()) {
  return {id:'seatline',
    discover:options=>client.call('discover',options),
    prepare:target=>client.call('prepare',{trigger:'job-start',target}),
    run:(target,request,options)=>client.call('run',{target,request},options),
    forget:(target,handles)=>client.call('forget',{target,handles}),
    cleanup:(target,group)=>client.call('cleanup',{target,group})};
}
export function createAnalysisEngine(store,client=new PathClient()) {
  const paths={seatline:workerPath(client)};
  return {engine:new AnalysisEngine({store,paths}),maintenance:new MaintenanceDispatcher(store,paths)};
}
