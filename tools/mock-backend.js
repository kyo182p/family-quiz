/* This adapter and its deliberately non-cryptographic JS hash are only for the mock backend. */
(() => {
  const mode=new URLSearchParams(location.search).get('mock');
  const fixtures=window.MOCK_DIAG_FIXTURES;
  delete window.MOCK_DIAG_FIXTURES;
  const ai=request=>{
    const payload=JSON.parse(request.payload),content=payload.messages[0].content;
    const prompt=content.filter(x=>x.type==='text').map(x=>x.text).join('');
    let result;
    if(prompt.startsWith('DIAG_PAGE')){
      const input=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
      if(mode==='diag-fail2'&&input.page===2)return {code:500,body:{}};
      result=JSON.parse(JSON.stringify(fixtures.page));
      result.items.forEach(x=>{x.q_no=String((input.page-1)*4+Number(x.q_no));});
      if(mode==='diag-zero')result.items=[];
      if(mode==='diag-name')result.items[0].question_text+=' 姓名：虛構甲';
    }else if(prompt.startsWith('DIAG_VERIFY')){
      const input=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
      result=input.map(x=>({i:x.i,answer:'5',code:fixtures.check.find(q=>q.q===x.q)?.targetCode||'N-1-1'}));
    }else{
      const input=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
      result=input.weak.flatMap((w,n)=>fixtures.check.slice(0,5).map((x,i)=>({...x,id:'c'+n+i,weakKey:w.key,pairId:w.key+':'+Math.floor(i/2),targetCode:w.code||input.whitelist[0]?.code||'',verifyAnswer:'5',verifyCode:w.code||input.whitelist[0]?.code||''})));
    }
    return {code:200,body:{content:[{type:'text',text:JSON.stringify(result)}],stop_reason:'end_turn'}};
  };
  const bytes = value => typeof value === 'string' ? Array.from(unescape(encodeURIComponent(value)), c=>c.charCodeAt(0)) : Array.from(value, n=>n&255);
  function digest(value) {
    let h=2166136261;
    const data=bytes(value);
    return Array.from({length:32},(_,i)=>{for(const b of data)h=Math.imul(h^b,16777619);h=Math.imul(h^i,16777619);return h>>>((i%4)*8)&255});
  }
  const env=createGasEnv({source:window.MOCK_GAS_SOURCE,now:Date.now(),ai,
    hash:{digest:(_,v)=>digest(v),hmac:(v,k)=>digest(bytes(k).concat(bytes(v)))},
    base64:v=>btoa(String.fromCharCode(...bytes(v))),
    evaluate:(source,globals)=>new Function(...Object.keys(globals),source+'\nreturn name=>eval(name);')(...Object.values(globals))
  });
  delete window.MOCK_GAS_SOURCE;
  const old=localStorage.getItem('mock-gas-state');
  if(old)env.restore(JSON.parse(old));
  else {
    env.run('setup');
    env.run('playerSave','TEST-0000',{playerId:'p1',name:'小葉子',icon:'🌱'});
    env.sheets.get('玩家').appendRow(['TEST-0000','p2','小石頭','🐢',1,'啟用',new Date(),new Date(),'']);
    const badgeAt=Date.now()-10000;
    for(const [pid,silver,gold] of [['p1',5,2],['p2',1,0]]) {
      const earned=Array.from({length:silver+gold},(_,i)=>({at:badgeAt-i,dark:i>=silver}));
      env.doPost({action:'badges',code:'TEST-0000',playerId:pid,badges:{demo:{earned}}});
    }
    if(mode!=='empty')for(const [id,name,s,g] of [['mock-s','一起玩桌遊',2,0],['mock-g','選一本故事書',0,1],['mock-sg','週末小旅行',3,1]])env.sheets.get('獎勵').appendRow([id,'TEST-0000',name,s,g,true,2,true,new Date()]);
    env.props.setProperty('pinsetup:TEST-0000',env.run('parentHash','MOCK2345'));
    localStorage.setItem('family',JSON.stringify({code:'TEST-0000',name:'示範家庭'}));
  }
  env.props.setProperty('DIAG_SHEET_ID','mock-diag');
  env.run('setupDiag');
  const persist=()=>localStorage.setItem('mock-gas-state',JSON.stringify(env.snapshot()));persist();
  const nativeFetch=window.fetch;
  window.fetch=async (url,options={})=>{
    if(String(url)!=='mock://gas')return nativeFetch?nativeFetch(url,options):Promise.reject(new Error('No fetch adapter'));
    if(mode==='offline')throw new Error('Mock offline');
    if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,1500));
    if(options.signal?.aborted)throw new DOMException('Aborted','AbortError');
    env.clock.set(Date.now());
    const result=env.doPost(JSON.parse(options.body));persist();
    return {ok:true,status:200,json:async()=>result,text:async()=>JSON.stringify(result)};
  };
})();
