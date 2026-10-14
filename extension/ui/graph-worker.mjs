import {layoutGraph} from '../../src/ui/graph-layout.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,layout:layoutGraph(data.graph,data.lens)});}catch{self.postMessage({id:data.id,error:'Map layout is unavailable. Use the text outline.'});}};
