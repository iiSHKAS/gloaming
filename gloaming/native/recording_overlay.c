/* Gloaming recording-only overlay. GSR ABI: plugin/plugin.h from
 * https://git.dec05eba.com/gpu-screen-recorder (see GSR-LICENSE).
 * Pixels are private, atomically published Cairo BGRA panels, not screen windows. */
#define _GNU_SOURCE
#define GL_GLEXT_PROTOTYPES
#include "gsr_plugin.h"
#include <GL/gl.h>
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
#include <limits.h>

typedef struct { uint32_t w,h,pos; int32_t x,y; } Panel;
typedef struct {
    GLuint program,vao,vbo,textures[2];
    Panel panels[2]; unsigned count;
    char frame[PATH_MAX],ready[PATH_MAX];
    ino_t inode; struct timespec stamp;
} Overlay;
static GLuint shader(GLenum type,const char *src) {
    GLuint s=glCreateShader(type); glShaderSource(s,1,&src,NULL);glCompileShader(s);
    GLint ok=0;glGetShaderiv(s,GL_COMPILE_STATUS,&ok);
    if(!ok){glDeleteShader(s);return 0;}return s;
}
static bool damaged(void *ptr) {
    Overlay *o=ptr;struct stat st;
    return stat(o->frame,&st)==0 && (st.st_ino!=o->inode || st.st_mtim.tv_sec!=o->stamp.tv_sec || st.st_mtim.tv_nsec!=o->stamp.tv_nsec);
}
static void update(Overlay *o) {
    struct stat st; if(stat(o->frame,&st)!=0 || (st.st_ino==o->inode && st.st_mtim.tv_sec==o->stamp.tv_sec && st.st_mtim.tv_nsec==o->stamp.tv_nsec))return;
    FILE *f=fopen(o->frame,"rb");if(!f)return;
    uint32_t hdr[2];unsigned char *pixels[2]={0};Panel panels[2];bool ok=false;
    if(fread(hdr,sizeof(hdr),1,f)!=1 || hdr[0]!=0x564f5631 || hdr[1]>2)goto done;
    for(unsigned i=0;i<hdr[1];++i){
        if(fread(&panels[i],sizeof(Panel),1,f)!=1)goto done;
        Panel p=panels[i];if(!p.w||!p.h||p.w>2048||p.h>2048||p.pos>5)goto done;
        size_t bytes=(size_t)p.w*p.h*4;pixels[i]=malloc(bytes);
        if(!pixels[i]||fread(pixels[i],1,bytes,f)!=bytes)goto done;
    }
    for(unsigned i=0;i<hdr[1];++i){
        glBindTexture(GL_TEXTURE_2D,o->textures[i]);
        glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA,panels[i].w,panels[i].h,0,GL_RGBA,GL_UNSIGNED_BYTE,pixels[i]);
        o->panels[i]=panels[i];
    }
    o->count=hdr[1];ok=true;
done:
    for(int i=0;i<2;++i)free(pixels[i]);fclose(f);
    if(ok){o->inode=st.st_ino;o->stamp=st.st_mtim;}
}
static void draw(const gsr_plugin_draw_params *params,void *ptr) {
    Overlay *o=ptr;
    GLboolean blend=glIsEnabled(GL_BLEND);
    GLint src_rgb,dst_rgb,src_a,dst_a;
    glGetIntegerv(GL_BLEND_SRC_RGB,&src_rgb);glGetIntegerv(GL_BLEND_DST_RGB,&dst_rgb);
    glGetIntegerv(GL_BLEND_SRC_ALPHA,&src_a);glGetIntegerv(GL_BLEND_DST_ALPHA,&dst_a);
    glActiveTexture(GL_TEXTURE0);update(o);
    /* GSR has already drawn the capture into this framebuffer. Preserve it. */
    glUseProgram(o->program);glBindVertexArray(o->vao);glBindBuffer(GL_ARRAY_BUFFER,o->vbo);
    glEnable(GL_BLEND);glBlendFunc(GL_ONE,GL_ONE_MINUS_SRC_ALPHA);
    for(unsigned i=0;i<o->count;++i){
        Panel p=o->panels[i];float margin=32.0f*params->height/1080;
        float x=margin,y=params->height-p.h-margin;
        if(p.pos==1||p.pos==3)x=params->width-p.w-margin;
        if(p.pos==2||p.pos==3)y=margin;
        if(p.pos==4)x=((float)params->width-p.w)/2;
        if(p.pos==5){x=p.x;y=p.y;}
        if(x+p.w>params->width)x=(float)params->width-p.w;if(x<0)x=0;
        if(y+p.h>params->height)y=(float)params->height-p.h;if(y<0)y=0;
        float l=2*x/params->width-1,r=2*(x+p.w)/params->width-1;
        /* GSR's capture framebuffer maps its bottom GL row to the video's top.
           Match that transform for both placement and top-down Cairo pixels. */
        float t=2*y/params->height-1,b=2*(y+p.h)/params->height-1;
        float v[]={l,t,0,0,l,b,0,1,r,t,1,0,r,b,1,1};
        glBufferSubData(GL_ARRAY_BUFFER,0,sizeof(v),v);glBindTexture(GL_TEXTURE_2D,o->textures[i]);
        glDrawArrays(GL_TRIANGLE_STRIP,0,4);
    }
    glBlendFuncSeparate(src_rgb,dst_rgb,src_a,dst_a);
    if(!blend)glDisable(GL_BLEND);
    glBindVertexArray(0);glBindBuffer(GL_ARRAY_BUFFER,0);glBindTexture(GL_TEXTURE_2D,0);glUseProgram(0);
}
void gsr_plugin_deinit(void *ptr) {
    Overlay *o=ptr;if(!o)return;
    glDeleteTextures(2,o->textures);glDeleteBuffers(1,&o->vbo);glDeleteVertexArrays(1,&o->vao);glDeleteProgram(o->program);
    unlink(o->ready);free(o);
}
bool gsr_plugin_init(const gsr_plugin_init_params *params,gsr_plugin_init_return *ret) {
    Overlay *o=calloc(1,sizeof(*o));Dl_info info;
    if(!o)return false;
    if(!dladdr((void*)gsr_plugin_init,&info) || strlen(info.dli_fname)>PATH_MAX-32){free(o);return false;}
    char dir[PATH_MAX];strcpy(dir,info.dli_fname);char *slash=strrchr(dir,'/');if(!slash){free(o);return false;}*slash=0;
    snprintf(o->frame,sizeof(o->frame),"%s/frame.bin",dir);snprintf(o->ready,sizeof(o->ready),"%s/ready",dir);
    GLuint vs=shader(GL_VERTEX_SHADER,"attribute vec4 point; varying vec2 uv; void main(){gl_Position=vec4(point.xy,0.,1.);uv=point.zw;}");
    const char *fsrc=params->graphics_api==GSR_PLUGIN_GRAPHICS_API_EGL_ES ?
        "precision mediump float; varying vec2 uv; uniform sampler2D panel; void main(){gl_FragColor=texture2D(panel,uv).bgra;}" :
        "varying vec2 uv; uniform sampler2D panel; void main(){gl_FragColor=texture2D(panel,uv).bgra;}";
    GLuint fs=shader(GL_FRAGMENT_SHADER,fsrc);
    o->program=glCreateProgram();glAttachShader(o->program,vs);glAttachShader(o->program,fs);
    glBindAttribLocation(o->program,0,"point");glLinkProgram(o->program);glDeleteShader(vs);glDeleteShader(fs);
    GLint ok=0;glGetProgramiv(o->program,GL_LINK_STATUS,&ok);if(!ok){gsr_plugin_deinit(o);return false;}
    glGenVertexArrays(1,&o->vao);glBindVertexArray(o->vao);glGenBuffers(1,&o->vbo);glBindBuffer(GL_ARRAY_BUFFER,o->vbo);
    glBufferData(GL_ARRAY_BUFFER,16*sizeof(float),NULL,GL_DYNAMIC_DRAW);glEnableVertexAttribArray(0);
    glVertexAttribPointer(0,4,GL_FLOAT,GL_FALSE,4*sizeof(float),0);glBindVertexArray(0);glBindBuffer(GL_ARRAY_BUFFER,0);
    glGenTextures(2,o->textures);
    for(int i=0;i<2;++i){glBindTexture(GL_TEXTURE_2D,o->textures[i]);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);}
    glBindTexture(GL_TEXTURE_2D,0);
    FILE *f=fopen(o->ready,"w");if(!f){gsr_plugin_deinit(o);return false;}
    fprintf(f,"%u %u\n",params->width,params->height);fclose(f);
    ret->name="Gloaming recording inputs";ret->version=1;ret->userdata=o;ret->draw=draw;ret->is_damaged=damaged;ret->clear_damage=NULL;
    return true;
}
