'use strict';
function productionVerificationUrl(input){
 const url=new URL(input);
 if(!['http:','https:'].includes(url.protocol)||url.hostname!=='app.chasingmajors.com'||url.username||url.password||url.port)throw Error('Unexpected production deployment URL');
 url.protocol='https:';
 return url.href;
}
if(require.main===module){try{console.log(productionVerificationUrl(process.argv[2]));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={productionVerificationUrl};
