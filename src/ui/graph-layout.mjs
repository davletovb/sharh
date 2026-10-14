import dagre from '@dagrejs/dagre';
import {hierarchy,tree} from 'd3-hierarchy';
import {forceSimulation,forceLink,forceManyBody,forceCollide,forceCenter} from 'd3-force';
export function graphRecords(entries,lens,collapsed=[]) {
  const rows=entries.map(e=>e.record),all=rows.filter(r=>['sec','node','concept'].includes(r.t)),byId=new Map(all.map(r=>[r.id,r]));
  const hidden=new Set(),folded=new Set(collapsed);
  for(const r of all) {let p=byId.get(r.parent),seen=new Set();while(p && !seen.has(p.id)){seen.add(p.id);if(folded.has(p.id)){hidden.add(r.id);break;}p=byId.get(p.parent);}}
  const nodes=all.filter(r=>!hidden.has(r.id)).map(r=>({id:r.id,label:r.title??r.term??r.text,kind:r.role??r.kind??'concept',record:r}));
  const known=new Set(nodes.map(n=>n.id));
  const links=lens==='structure'?nodes.filter(n=>known.has(n.record.parent)).map(n=>({from:n.record.parent,to:n.id,label:'contains'})):
    rows.filter(r=>r.t==='edge' && known.has(r.from) && known.has(r.to)).map(r=>({from:r.from,to:r.to,label:r.rel}));
  return {nodes,links};
}
export function layoutGraph({nodes,links},lens) {
  if(!nodes.length)return {nodes:[],links:[],width:500,height:240};
  nodes=nodes.map(n=>({...n}));links=links.map(l=>({...l}));
  if(lens==='structure') {
    const map=new Map(nodes.map(n=>[n.id,{...n,children:[]}])),root={id:'',children:[]};
    for(const n of map.values())(map.get(n.record.parent)??root).children.push(n);
    const result=tree().nodeSize([105,250])(hierarchy(root));
    for(const h of result.descendants())if(h.depth){const n=nodes.find(n=>n.id===h.data.id);n.x=h.y-125;n.y=h.x;}
  }else if(lens==='thinking') {
    const simulation=forceSimulation(nodes).stop().force('charge',forceManyBody().strength(-1200)).force('collide',forceCollide(125))
      .force('link',forceLink(links.map(l=>({source:l.from,target:l.to}))).id(n=>n.id).distance(260)).force('center',forceCenter(350,250));
    simulation.tick(100);simulation.stop();
  }else {
    const g=new dagre.graphlib.Graph({multigraph:true}).setGraph({rankdir:'TB',nodesep:50,ranksep:85,marginx:25,marginy:25}).setDefaultEdgeLabel(()=>({}));
    for(const n of nodes)g.setNode(n.id,{width:200,height:65});for(const [i,l]of links.entries())g.setEdge(l.from,l.to,{},String(i));dagre.layout(g);
    for(const n of nodes){const p=g.node(n.id);n.x=p.x;n.y=p.y;}
  }
  const minX=Math.min(...nodes.map(n=>n.x)),minY=Math.min(...nodes.map(n=>n.y));
  for(const n of nodes){n.x=n.x-minX+125;n.y=n.y-minY+65;}
  return {nodes,links,width:Math.max(500,...nodes.map(n=>n.x+125)),height:Math.max(220,...nodes.map(n=>n.y+65))};
}
