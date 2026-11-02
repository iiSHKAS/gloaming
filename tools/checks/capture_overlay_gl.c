/* Offscreen GSR ABI integration and draw-cost measurement; no desktop capture. */
#define GL_GLEXT_PROTOTYPES
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <GL/gl.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include "../../gloaming/native/gsr_plugin.h"
static double now(){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec+t.tv_nsec/1e9;}
int main(int argc,char **argv){
 if(argc!=2&&argc!=3)return 2;
 EGLDisplay d=EGL_NO_DISPLAY;EGLint major,minor;
 PFNEGLQUERYDEVICESEXTPROC devices=(void*)eglGetProcAddress("eglQueryDevicesEXT");
 PFNEGLGETPLATFORMDISPLAYEXTPROC platform=(void*)eglGetProcAddress("eglGetPlatformDisplayEXT");
 if(devices&&platform){EGLDeviceEXT list[16];EGLint count=0;devices(16,list,&count);
 for(int i=0;i<count;++i){EGLDisplay candidate=platform(EGL_PLATFORM_DEVICE_EXT,list[i],NULL);
 if(eglInitialize(candidate,&major,&minor)){d=candidate;break;}}}
 if(d==EGL_NO_DISPLAY)d=eglGetDisplay(EGL_DEFAULT_DISPLAY);
 if(!eglInitialize(d,&major,&minor)){fprintf(stderr,"EGL init failed %x\n",eglGetError());return 3;}
 eglBindAPI(EGL_OPENGL_ES_API);
 EGLint attrs[]={EGL_SURFACE_TYPE,EGL_PBUFFER_BIT,EGL_RENDERABLE_TYPE,EGL_OPENGL_ES3_BIT,EGL_RED_SIZE,8,EGL_GREEN_SIZE,8,EGL_BLUE_SIZE,8,EGL_ALPHA_SIZE,8,EGL_NONE};
 EGLConfig config;EGLint n;if(!eglChooseConfig(d,attrs,&config,1,&n)||!n)return 4;
 EGLint size[]={EGL_WIDTH,2560,EGL_HEIGHT,1440,EGL_NONE},ca[]={EGL_CONTEXT_CLIENT_VERSION,3,EGL_NONE};
 EGLSurface surf=eglCreatePbufferSurface(d,config,size);EGLContext ctx=eglCreateContext(d,config,EGL_NO_CONTEXT,ca);
 if(!eglMakeCurrent(d,surf,surf,ctx))return 5;
 printf("GPU: %s\n",glGetString(GL_RENDERER));glViewport(0,0,2560,1440);
 void *lib=dlopen(argv[1],RTLD_NOW);if(!lib){fprintf(stderr,"%s\n",dlerror());return 6;}
 bool (*init)(const gsr_plugin_init_params*,gsr_plugin_init_return*)=dlsym(lib,"gsr_plugin_init");
 void (*deinit)(void*)=dlsym(lib,"gsr_plugin_deinit");
 gsr_plugin_init_params p={2560,1440,60,GSR_PLUGIN_COLOR_DEPTH_8_BITS,GSR_PLUGIN_GRAPHICS_API_EGL_ES};gsr_plugin_init_return r={0};
 if(!init(&p,&r))return 7;
 glClearColor(.2,.3,.4,1);glClear(GL_COLOR_BUFFER_BIT);
 gsr_plugin_draw_params dp={2560,1440};r.draw(&dp,r.userdata);glFinish();
 if(argc==3){
  /* An asymmetric Cairo fixture must retain its top/bottom in video order. */
  unsigned char top[4],bottom[4];
  glReadPixels(104,104,1,1,GL_RGBA,GL_UNSIGNED_BYTE,top);
  glReadPixels(104,112,1,1,GL_RGBA,GL_UNSIGNED_BYTE,bottom);
  if(top[0]!=255||top[2]!=0||bottom[0]!=0||bottom[2]!=255)return 12;
  printf("Video placement and top-down texture orientation: PASS\n");
  deinit(r.userdata);return 0;
 }
 unsigned char *pixels=malloc(2560*1440*4);glReadPixels(0,0,2560,1440,GL_RGBA,GL_UNSIGNED_BYTE,pixels);
 long long sum=0;int changed_left=0,changed_right=0;
 for(int i=0;i<2560*1440;++i){sum+=pixels[i*4+3];
 /* GSR exports GL rows in video order: high GL rows are the video's bottom. */
 if(i/2560>840 && abs(pixels[i*4]-51)+abs(pixels[i*4+1]-77)+abs(pixels[i*4+2]-102)>10){
 if(i%2560<1280)++changed_left;else ++changed_right;}}
 free(pixels);if(changed_left<1000||changed_right<1000)return 11;
 printf("Both bottom panels visible: %d / %d pixels\n",changed_left,changed_right);
 printf("alpha_sum: %lld\n",sum);if(sum!=2560LL*1440*255)return 8;
 unsigned char center[4];glReadPixels(1280,720,1,1,GL_RGBA,GL_UNSIGNED_BYTE,center);
 if(abs(center[0]-51)>1||abs(center[1]-77)>1||abs(center[2]-102)>1)return 10;
 printf("capture background preserved\n");
 for(int i=0;i<20;++i)r.draw(&dp,r.userdata);glFinish();
 double t=now();for(int i=0;i<300;++i){glClearColor(0,0,0,0);glClear(GL_COLOR_BUFFER_BIT);glFinish();}double baseline=(now()-t)/300;
 t=now();for(int i=0;i<300;++i){glClearColor(0,0,0,0);glClear(GL_COLOR_BUFFER_BIT);r.is_damaged(r.userdata);r.draw(&dp,r.userdata);glFinish();}double draw=(now()-t)/300;
 printf("baseline_ms: %.4f, overlay_ms: %.4f, delta_ms: %.4f\n",baseline*1000,draw*1000,(draw-baseline)*1000);
 GLenum error=glGetError();printf("GL error: %u\n",error);
 deinit(r.userdata);dlclose(lib);eglMakeCurrent(d,EGL_NO_SURFACE,EGL_NO_SURFACE,EGL_NO_CONTEXT);eglDestroyContext(d,ctx);eglDestroySurface(d,surf);eglTerminate(d);
 return error?9:0;
}
