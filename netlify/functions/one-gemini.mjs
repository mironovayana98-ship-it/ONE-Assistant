// ONE Gemini for Netlify Functions. Secrets must be environment variables, never client files.
const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','access-control-allow-origin':'same-origin'}});
const LANG={ru:'русском',uk:'украинском',fr:'французском',en:'английском'};
let counters=new Map(); // best-effort per-instance limiter; NOT a global durable quota
export default async function handler(request){
 if(request.method!=='POST')return reply({error:'Только POST'},405);
 if(!(request.headers.get('content-type')||'').includes('application/json'))return reply({error:'Нужен JSON'},415);
 const key=process.env.GEMINI_API_KEY;
 const accessCode=process.env.ONE_FAMILY_CODE;
 if(!key)return reply({error:'Gemini ещё не подключён. Администратор должен добавить GEMINI_API_KEY в Netlify.'},503);
 if(!accessCode || accessCode.length<8)return reply({error:'Для безопасного семейного теста настройте ONE_FAMILY_CODE (не менее 8 символов) в Netlify.'},503);
 try{
  const raw=await request.text();if(raw.length>2500000)return reply({error:'Запрос слишком большой (максимум около 2 МБ)'},413);
  const data=JSON.parse(raw),question=data.question,lang=data.lang,image=data.image,code=data.code;
  if(typeof code!=='string'||code!==accessCode)return reply({error:'Неверный семейный код доступа.'},403);
  if(typeof question!=='string'||question.length>1800||!Object.hasOwn(LANG,lang))return reply({error:'Проверьте текст вопроса и язык.'},400);
  if(!question.trim()&&!image)return reply({error:'Напишите вопрос или приложите фото.'},400);
  if(image!=null && (typeof image!=='string'||image.length>2000000||!/^data:image\/(jpeg|png|webp);base64,/.test(image)))return reply({error:'Фото должно быть JPG/PNG/WEBP, уменьшенное до 1,5 МБ.'},400);
  let now=Date.now(),keyhash=code.slice(0,4),record=counters.get(keyhash)||{ts:now,n:0};if(now-record.ts>3600000)record={ts:now,n:0};if(record.n>=30)return reply({error:'Семейный лимит на этом сервере временно исчерпан. Попробуйте позже.'},429);record.n++;counters.set(keyhash,record);
  const parts=[{text:question.trim()||'Объясните, что видно на изображении, и какие безопасные шаги можно сделать дальше.'}];
  if(image){let match=image.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);parts.push({inline_data:{mime_type:match[1],data:match[2]}})}
  const instruction=`Ты ONE — спокойный, внимательный помощник для людей, которым трудно пользоваться телефонами. Отвечай на ${LANG[lang]} языке простыми короткими предложениями и по возможности одним следующим действием за раз. Если непонятна модель телефона или версия программы, спроси. Для скриншота опирайся только на видимые элементы, не выдумывай надписи. Не утверждай, что сам нажимаешь кнопки или видишь текущий экран без разрешения. Не проси и не храни пароли, PIN, CVV, номера карт, одноразовые коды. При входе в банк объясняй только общую навигацию в официальном приложении; любые платежи пользователь делает и подтверждает самостоятельно. Если речь о лекарствах — не рекомендуй дозы или изменение лечения; только поясни, как поставить напоминание по уже назначенному графику. Для удаления файлов предложи сначала проверить резервные копии. При юридически значимых документах сообщай о необходимости проверки официального источника. Если спросили об актуальных скидках, ценах или расписании, честно скажи, что здесь нет живого доступа к магазинам. В завершение спроси, получилось ли сделать следующий шаг. Никогда не давай больше 5 коротких шагов сразу.`;
  const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),24000);
  let r;try{r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.ONE_GEMINI_MODEL||'gemini-2.5-flash-lite')}:generateContent`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify({system_instruction:{parts:[{text:instruction}]},contents:[{role:'user',parts}],generationConfig:{maxOutputTokens:750,temperature:0.25}}),signal:ctrl.signal})}finally{clearTimeout(timeout)}
  const result=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===429)return reply({error:'Бесплатный лимит Gemini исчерпан. Попробуйте позже или используйте готовые инструкции ONE.'},429);if(r.status===400)return reply({error:'Gemini не смог обработать этот запрос. Попробуйте меньшее фото.'},502);return reply({error:'Gemini временно недоступен. Проверьте API-ключ и доступность бесплатной модели.'},502)}
  const answer=(result.candidates?.[0]?.content?.parts||[]).map(x=>x.text||'').join('\n').trim();
  return reply({answer:answer||'Ответ не получен. Попробуйте другой вопрос.'});
 }catch(e){return reply({error:e?.name==='AbortError'?'Ответ занимает слишком много времени. Попробуйте ещё раз.':'Ошибка обработки. Проверьте соединение и повторите.'},503)}
}
